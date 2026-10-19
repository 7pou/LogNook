import { expect, test } from 'vitest'
import { decodeLogEvent, encodeLogEvent, isLogsSnapshot } from '../src/log-protocol'

test('encodes a single escaped SSE frame', () => {
  expect(encodeLogEvent({ type: 'append', cursor: { sessionId: 'session', revision: 1 }, entry: { kind: 'raw', raw: 'first\nsecond' } }))
    .toBe('id: session:1\nevent: append\ndata: {"cursor":{"sessionId":"session","revision":1},"entry":{"kind":"raw","raw":"first\\nsecond"}}\n\n')
})

test.each(['ready', 'reset', 'resync'])('decodes %s control', (type) => {
  expect(decodeLogEvent(type, '{"cursor":{"sessionId":"session","revision":0}}')).toEqual({ type, cursor: { sessionId: 'session', revision: 0 } })
})

test('preserves color when decoding an append event', () => {
  const data = '{"cursor":{"sessionId":"session","revision":1},"entry":{"kind":"structured","timestamp":"2026-10-15T02:00:00Z","color":"#ef4444","message":"message"}}'
  expect(decodeLogEvent('append', data)).toMatchObject({ type: 'append', entry: { color: '#ef4444', message: 'message' } })
})

test.each([123, null, {}, []])('rejects append events and snapshots with non-string color %j', (color) => {
  const entry = { kind: 'structured', timestamp: '2026-10-15T02:00:00Z', color, message: 'message' }
  const cursor = { sessionId: 'session', revision: 1 }
  expect(() => decodeLogEvent('append', JSON.stringify({ cursor, entry }))).toThrow()
  expect(isLogsSnapshot({ filename: 'app.log', query: '', total: 1, matched: 1, entries: [entry], cursor, clearToken: '1'.repeat(32) })).toBe(false)
})

test.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid revision %s', (revision) => {
  expect(() => decodeLogEvent('reset', JSON.stringify({ cursor: { sessionId: 'session', revision } }))).toThrow()
})

test.each([
  ['ready', 'null'], ['ready', '{}'], ['reset', '{"cursor":{"sessionId":"","revision":0}}'],
  ['append', '{"cursor":{"sessionId":"session","revision":1}}'],
  ['append', '{"cursor":{"sessionId":"session","revision":1},"entry":{"kind":"structured","timestamp":"bad","message":1}}'],
  ['other', '{"cursor":{"sessionId":"session","revision":0}}'], ['reset', 'not JSON'],
])('rejects malformed %s event %s', (type, data) => expect(() => decodeLogEvent(type, data)).toThrow())

test('validates the complete snapshot and its counts', () => {
  const snapshot = { filename: 'app.log', query: '', total: 0, matched: 0, entries: [], cursor: { sessionId: 'session', revision: 0 }, clearToken: '1'.repeat(32) }
  expect(isLogsSnapshot(snapshot)).toBe(true)
  expect(isLogsSnapshot({ ...snapshot, matched: 1 })).toBe(false)
  expect(isLogsSnapshot({ ...snapshot, total: '0' })).toBe(false)
  expect(isLogsSnapshot({ ...snapshot, clearToken: '' })).toBe(false)
  expect(isLogsSnapshot({ ...snapshot, cursor: null })).toBe(false)
  expect(isLogsSnapshot({ ...snapshot, colors: ['red', 'blue'] })).toBe(true)
  expect(isLogsSnapshot({ ...snapshot, colors: 'red' })).toBe(false)
  expect(isLogsSnapshot({ ...snapshot, colors: [123] })).toBe(false)
})
