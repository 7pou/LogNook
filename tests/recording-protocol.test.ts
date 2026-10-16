import { expect, test } from 'vitest'
import { decodeRecordingEvent, encodeRecordingEvent, isRecordingSnapshot } from '../src/recording-protocol'

const snapshot = { sessionId: 'session', revision: 2, state: 'pause' as const }

test('recording metadata round-trips without changing the SSE log event ID', () => {
  expect(isRecordingSnapshot(snapshot)).toBe(true)
  expect(encodeRecordingEvent(snapshot)).toBe('event: recording\ndata: {"sessionId":"session","revision":2,"state":"pause"}\n\n')
  expect(decodeRecordingEvent(JSON.stringify(snapshot))).toEqual(snapshot)
})

test.each([null, {}, { ...snapshot, state: 'closed' }, { ...snapshot, revision: -1 }, { ...snapshot, revision: 1.5 }, { ...snapshot, sessionId: 'bad\nsession' }])('rejects invalid recording metadata %j', (value) => {
  expect(isRecordingSnapshot(value)).toBe(false)
  expect(() => decodeRecordingEvent(JSON.stringify(value))).toThrow()
})
