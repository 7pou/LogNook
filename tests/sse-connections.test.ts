import { EventEmitter } from 'node:events'
import type { ServerResponse } from 'node:http'
import { afterEach, expect, test, vi } from 'vitest'
import { SseConnections } from '../src/sse-connections'
import { MAX_BUFFER_BYTES, SSE_HEARTBEAT_MS } from '../src/log-protocol'
import type { LogStreamEvent } from '../src/log-types'
import type { RecordingSnapshot } from '../src/recording-protocol'
import { deferred } from './helpers'

class Response extends EventEmitter {
  headersSent = false
  destroyed = false
  writableLength = 0
  frames: string[] = []
  headers: Record<string, string> = {}
  writeHead(_status: number, headers: Record<string, string>) { this.headers = headers; this.headersSent = true; return this }
  flushHeaders() { this.headersSent = true }
  write(frame: string) { this.frames.push(frame); return false }
  destroy() { this.destroyed = true; this.emit('close'); return this }
  asHttp() { return this as unknown as ServerResponse }
}
const cursor = { sessionId: 'session', revision: 0 }
afterEach(() => vi.useRealTimers())

test('queued ready opens SSE; heartbeat has no cursor; close releases subscription', async () => {
  vi.useFakeTimers()
  const pool = new SseConnections()
  const response = new Response()
  const gate = deferred<void>()
  const unsubscribe = vi.fn()
  const connecting = pool.connect(response.asHttp(), async (listener) => {
    await gate.promise
    listener({ type: 'ready', cursor })
    return unsubscribe
  })
  expect(response.headersSent).toBe(false)
  gate.resolve()
  await connecting
  expect(response.headers['Content-Type']).toBe('text/event-stream; charset=utf-8')
  expect(response.frames[0]).toContain('event: ready')
  vi.advanceTimersByTime(SSE_HEARTBEAT_MS)
  expect(response.frames.at(-1)).toBe(': ping\n\n')
  response.emit('close')
  expect(unsubscribe).toHaveBeenCalledTimes(1)
  const count = response.frames.length
  vi.advanceTimersByTime(SSE_HEARTBEAT_MS)
  expect(response.frames).toHaveLength(count)
  pool.close()
})

test('oversized frame resyncs and a slow client disconnects without blocking others', async () => {
  const pool = new SseConnections()
  const response = new Response()
  let send!: (event: LogStreamEvent) => void
  const unsubscribe = vi.fn()
  await pool.connect(response.asHttp(), async (listener) => { send = listener; listener({ type: 'ready', cursor }); return unsubscribe })
  send({ type: 'append', cursor: { ...cursor, revision: 1 }, entry: { kind: 'raw', raw: '汉'.repeat(MAX_BUFFER_BYTES) } })
  expect(response.frames.at(-1)).toContain('event: resync')
  expect(response.destroyed).toBe(false)
  response.writableLength = MAX_BUFFER_BYTES
  send({ type: 'reset', cursor: { ...cursor, revision: 2 } })
  expect(response.destroyed).toBe(true)
  expect(unsubscribe).toHaveBeenCalledTimes(1)
  pool.close()
})

test('early close disposes late unsubscribe; rejection before headers leaves JSON response usable', async () => {
  const pool = new SseConnections()
  const response = new Response()
  const gate = deferred<() => void>()
  const unsubscribe = vi.fn()
  const connecting = pool.connect(response.asHttp(), () => gate.promise)
  pool.close()
  gate.resolve(unsubscribe)
  await connecting
  expect(unsubscribe).toHaveBeenCalledTimes(1)
  const rejected = new Response()
  const otherPool = new SseConnections()
  await expect(otherPool.connect(rejected.asHttp(), async () => { throw new Error('closed') })).rejects.toThrow('closed')
  expect(rejected.destroyed).toBe(false)
  expect(rejected.headersSent).toBe(false)
  expect(rejected.listenerCount('close')).toBe(0)
  otherPool.close()
})

test('recording follows ready, has no ID, uses bounded writes and disposes both subscriptions', async () => {
  const pool = new SseConnections()
  const response = new Response()
  const snapshot = { ...cursor, state: 'open' as const }
  let send!: (value: RecordingSnapshot) => void
  const unsubscribe = vi.fn()
  const unsubscribeRecording = vi.fn()
  await pool.connect(response.asHttp(), async (listener) => { listener({ type: 'ready', cursor }); return unsubscribe }, {
    getSnapshot: () => snapshot, pause() {}, resume() {},
    subscribe(listener) { send = listener; listener(snapshot); return unsubscribeRecording },
  })
  expect(response.frames[0]).toContain('event: ready')
  expect(response.frames[1]).toContain('event: recording')
  expect(response.frames[1]).not.toContain('id: ')
  response.writableLength = MAX_BUFFER_BYTES
  send({ ...snapshot, revision: 1, state: 'pause' })
  expect(response.destroyed).toBe(true)
  expect(unsubscribe).toHaveBeenCalledOnce()
  expect(unsubscribeRecording).toHaveBeenCalledOnce()
  pool.close()
})

test('close during initial recording callback disposes even late subscriptions', async () => {
  const pool = new SseConnections()
  const response = new Response()
  const snapshot = { ...cursor, state: 'open' as const }
  const unsubscribe = vi.fn()
  const unsubscribeRecording = vi.fn()
  await pool.connect(response.asHttp(), async (listener) => { listener({ type: 'ready', cursor }); return unsubscribe }, {
    getSnapshot: () => snapshot, pause() {}, resume() {},
    subscribe(listener) { response.writableLength = MAX_BUFFER_BYTES; listener(snapshot); return unsubscribeRecording },
  })
  expect(response.destroyed).toBe(true)
  expect(unsubscribe).toHaveBeenCalledOnce()
  expect(unsubscribeRecording).toHaveBeenCalledOnce()
  pool.close()
})

test('recording subscription failure disconnects without rejecting the log subscription', async () => {
  const pool = new SseConnections()
  const response = new Response()
  const unsubscribe = vi.fn()
  await pool.connect(response.asHttp(), async (listener) => { listener({ type: 'ready', cursor }); return unsubscribe }, {
    getSnapshot: () => ({ ...cursor, state: 'open' }), pause() {}, resume() {},
    subscribe() { throw new Error('unavailable') },
  })
  expect(response.destroyed).toBe(true)
  expect(unsubscribe).toHaveBeenCalledOnce()
  expect(response.listenerCount('close')).toBe(0)
  pool.close()
})
