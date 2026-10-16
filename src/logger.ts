import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, open, readFile, truncate } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { LogInput } from './types'
import { parseLogs } from './log-parser'
import type { ClearLogsResponse, LogChangePayload, LogCursor, LogEntry, LogSnapshotData, LogStreamEvent } from './log-types'

export class LogStoreClosedError extends Error {
  readonly code = 'LOG_STORE_CLOSED'

  constructor() { super('Log store is closed') }
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

async function hasTerminatedTail(logPath: string): Promise<boolean | undefined> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(logPath, 'r')
    const { size } = await handle.stat()
    if (size === 0) return true
    const buffer = Buffer.alloc(1)
    const { bytesRead } = await handle.read(buffer, 0, 1, size - 1)
    return bytesRead === 1 ? buffer[0] === 10 : undefined
  } catch (error) {
    return isMissing(error) ? true : undefined
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

function serializeLogInput(input: string | LogInput): string {
  const timestamp = new Date().toISOString()
  const value = typeof input === 'string' ? { message: input } : input
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !Object.hasOwn(value, 'message')) {
    throw new TypeError('Log input must be a string or an object containing message')
  }
  const { title, message } = value
  if (title !== undefined && typeof title !== 'string') throw new TypeError('Log title must be a string')
  if (message === undefined || typeof message === 'function' || typeof message === 'symbol' || (typeof message === 'number' && !Number.isFinite(message))) {
    throw new TypeError('Log message must be JSON serializable')
  }
  const serialized = JSON.stringify(message)
  if (serialized === undefined) throw new TypeError('Log message must be JSON serializable')
  return JSON.stringify({ timestamp, title, message: JSON.parse(serialized) as unknown }) + '\n'
}

export class Logger {
  private pendingOperations: Promise<void> = Promise.resolve()
  private accepting = true
  readonly sessionId = randomUUID()
  private revision = 0
  private readonly listeners = new Set<(event: LogStreamEvent) => void>()

  constructor(private readonly logPath: string) {}

  log(input: string | LogInput): Promise<void> {
    if (!this.accepting) return Promise.reject(new LogStoreClosedError())
    let entry: string
    try {
      entry = serializeLogInput(input)
    } catch (error) {
      return Promise.reject(error)
    }
    return this.enqueue(async () => {
      const terminated = await hasTerminatedTail(this.logPath)
      await mkdir(dirname(this.logPath), { recursive: true })
      await appendFile(this.logPath, entry, 'utf8')
      const record = JSON.parse(entry) as Omit<Extract<LogEntry, { kind: 'structured' }>, 'kind'>
      this.commit(terminated === true ? { type: 'append', entry: { kind: 'structured', ...record } } : { type: 'resync' })
    })
  }

  readSnapshot(query = ''): Promise<LogSnapshotData> {
    return this.enqueue(async () => {
      let content = ''
      try { content = await readFile(this.logPath, 'utf8') } catch (error) { if (!isMissing(error)) throw error }
      return { ...parseLogs(content, query), cursor: this.cursor() }
    })
  }

  clear(): Promise<ClearLogsResponse> {
    return this.enqueue(async () => {
      try { await truncate(this.logPath, 0) } catch (error) { if (!isMissing(error)) throw error }
      this.commit({ type: 'reset' })
      return { cursor: this.cursor() }
    })
  }

  subscribe(listener: (event: LogStreamEvent) => void): Promise<() => void> {
    return this.enqueue(() => {
      this.listeners.add(listener)
      this.deliver(listener, { type: 'ready', cursor: this.cursor() })
      return () => { this.listeners.delete(listener) }
    })
  }

  stopAccepting(): void { this.accepting = false }

  flush(): Promise<void> {
    return this.pendingOperations
  }

  private enqueue<Value>(operation: () => Value | Promise<Value>): Promise<Value> {
    if (!this.accepting) return Promise.reject(new LogStoreClosedError())
    const result = this.pendingOperations.then(operation)
    this.pendingOperations = result.then(() => undefined, () => undefined)
    return result
  }

  private cursor(): LogCursor { return { sessionId: this.sessionId, revision: this.revision } }

  private commit(payload: LogChangePayload): void {
    this.revision += 1
    const event = { ...payload, cursor: this.cursor() } as LogStreamEvent
    for (const listener of this.listeners) this.deliver(listener, event)
  }

  private deliver(listener: (event: LogStreamEvent) => void, event: LogStreamEvent): void {
    try { listener(event) } catch { this.listeners.delete(listener) }
  }
}
