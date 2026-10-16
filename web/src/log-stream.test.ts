import { beforeEach, expect, test, vi } from 'vitest'
import { openLogStream } from './log-stream'
import { FakeEventSource } from './test/fake-event-source'

beforeEach(() => { FakeEventSource.instances = []; vi.stubGlobal('EventSource', FakeEventSource) })

test('decodes named events, leaves reconnect active, and ignores callbacks after disposal', () => {
  const handlers = { onEvent: vi.fn(), onDisconnect: vi.fn(), onProtocolError: vi.fn() }
  const close = openLogStream(handlers)
  const source = FakeEventSource.instances[0]!
  expect(source.url).toBe('/api/events')
  const event = { type: 'ready' as const, cursor: { sessionId: 'session', revision: 0 } }
  source.emit(event)
  expect(handlers.onEvent).toHaveBeenCalledWith(event)
  source.disconnect()
  expect(handlers.onDisconnect).toHaveBeenCalledOnce()
  expect(source.closed).toBe(false)
  close(); close()
  source.emit(event); source.disconnect()
  expect(source.closed).toBe(true)
  expect(handlers.onEvent).toHaveBeenCalledOnce()
  expect(handlers.onDisconnect).toHaveBeenCalledOnce()
})

test.each(['invalid', '{"cursor":{"sessionId":"s","revision":-1}}', '{"cursor":{"sessionId":"s","revision":0}}'])('rejects invalid payload or mismatched event ID %s', (data) => {
  const handlers = { onEvent: vi.fn(), onDisconnect: vi.fn(), onProtocolError: vi.fn() }
  const close = openLogStream(handlers)
  FakeEventSource.instances[0]!.dispatchEvent(new MessageEvent('ready', { data, lastEventId: 'wrong:0' }))
  expect(handlers.onEvent).not.toHaveBeenCalled()
  expect(handlers.onProtocolError).toHaveBeenCalledOnce()
  close()
})

test('recording shares the stream and ignores inherited log IDs; disposal removes its listener', () => {
  const handlers = { onEvent: vi.fn(), onRecording: vi.fn(), onDisconnect: vi.fn(), onProtocolError: vi.fn() }
  const close = openLogStream(handlers)
  const source = FakeEventSource.instances[0]!
  const snapshot = { sessionId: 'session', revision: 8, state: 'pause' as const }
  source.emitRecording(snapshot, 'session:2')
  expect(handlers.onRecording).toHaveBeenCalledWith(snapshot)
  expect(handlers.onEvent).not.toHaveBeenCalled()
  expect(handlers.onProtocolError).not.toHaveBeenCalled()
  source.dispatchEvent(new MessageEvent('recording', { data: '{}' }))
  expect(handlers.onProtocolError).toHaveBeenCalledOnce()
  close()
  source.emitRecording(snapshot)
  expect(handlers.onRecording).toHaveBeenCalledOnce()
  expect(FakeEventSource.instances).toHaveLength(1)
})
