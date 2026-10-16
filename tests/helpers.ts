import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { decodeLogEvent } from '../src/log-protocol'
import type { LogStreamEvent } from '../src/log-types'

export async function withTempDir<Result>(run: (directory: string) => Promise<Result>): Promise<Result> {
  const root = resolve(tmpdir())
  const directory = await mkdtemp(join(root, 'log-viewer-test-'))
  try {
    return await run(directory)
  } finally {
    if (dirname(directory) !== root || !basename(directory).startsWith('log-viewer-test-')) {
      throw new Error('Unsafe test cleanup target')
    }
    await rm(directory, { recursive: true, force: true })
  }
}

export async function createWebFixture(directory: string): Promise<string> {
  const webRoot = join(directory, 'web')
  await mkdir(join(webRoot, 'assets'), { recursive: true })
  await writeFile(join(webRoot, 'index.html'), '<html><body><div id="root"></div><script type="module" src="/assets/index-a1b2c3d4.js"></script></body></html>')
  await writeFile(join(webRoot, 'assets', 'index-a1b2c3d4.js'), 'export const fixture = true')
  await writeFile(join(webRoot, 'assets', 'index-a1b2c3d4.css'), 'body { color: black }')
  return webRoot
}

export function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: Error) => void
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

export async function openEventStream(url: string) {
  const controller = new AbortController()
  const response = await fetch(new URL('/api/events', url), { signal: controller.signal })
  if (!response.ok || !response.body) throw new Error(`SSE failed: ${response.status}`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  return {
    response,
    async next(): Promise<{ type: string; data: string }> {
      while (true) {
        const boundary = buffer.indexOf('\n\n')
        if (boundary >= 0) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const type = frame.split('\n').find((line) => line.startsWith('event: '))?.slice(7)
          const data = frame.split('\n').find((line) => line.startsWith('data: '))?.slice(6)
          if (type && data) return { type, data }
          continue
        }
        const result = await reader.read()
        if (result.done) throw new Error('SSE ended')
        buffer += decoder.decode(result.value, { stream: true })
      }
    },
    close() { controller.abort(); void reader.cancel().catch(() => undefined) },
  }
}

export async function openSse(url: string) {
  const stream = await openEventStream(url)
  return {
    ...stream,
    async next(): Promise<LogStreamEvent> {
      while (true) {
        const event = await stream.next()
        if (['ready', 'append', 'reset', 'resync'].includes(event.type)) return decodeLogEvent(event.type, event.data)
      }
    },
  }
}
