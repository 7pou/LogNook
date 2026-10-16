import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { fetchLogs } from './api'
import { useLogs } from './useLogs'
import { FakeEventSource } from './test/fake-event-source'
import { deferred, logs } from './test/fixtures'
import type { LogsSnapshot } from '../../src/log-types'

vi.mock('./api', () => ({ fetchLogs: vi.fn() }))
beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.mocked(fetchLogs).mockReset().mockResolvedValue(logs)
})

test('recording revisions never touch log data, batch, cursor or history requests', async () => {
  const { result } = renderHook(() => useLogs('', 0))
  const source = FakeEventSource.instances[0]!
  act(() => source.emit({ type: 'ready', cursor: logs.cursor }))
  await waitFor(() => expect(result.current.connection).toBe('live'))
  const data = result.current.data
  const batch = result.current.batch
  act(() => source.emitRecording({ sessionId: 'session', revision: 8, state: 'pause' }))
  expect(result.current.recording).toEqual({ sessionId: 'session', revision: 8, state: 'pause' })
  act(() => {
    source.emitRecording({ sessionId: 'session', revision: 7, state: 'open' })
    result.current.applyRecording({ sessionId: 'session', revision: 6, state: 'open' })
    result.current.applyRecording({ sessionId: 'other', revision: 9, state: 'open' })
  })
  expect(result.current.recording?.state).toBe('pause')
  expect(result.current.data).toBe(data)
  expect(result.current.batch).toBe(batch)
  expect(fetchLogs).toHaveBeenCalledOnce()
  expect(FakeEventSource.instances).toHaveLength(1)
})

test('accepts status before history completes and replaces it only on a new ready session', async () => {
  const history = deferred<LogsSnapshot>()
  vi.mocked(fetchLogs).mockReturnValueOnce(history.promise)
  const { result } = renderHook(() => useLogs('', 0))
  const source = FakeEventSource.instances[0]!
  act(() => {
    source.emit({ type: 'ready', cursor: logs.cursor })
    source.emitRecording({ sessionId: 'session', revision: 3, state: 'pause' })
  })
  expect(result.current.recording?.state).toBe('pause')
  await act(async () => history.resolve(logs))
  act(() => source.disconnect())
  act(() => result.current.applyRecording({ sessionId: 'session', revision: 4, state: 'open' }))
  expect(result.current.recording?.state).toBe('pause')
  vi.mocked(fetchLogs).mockResolvedValue({ ...logs, cursor: { sessionId: 'new', revision: 0 } })
  act(() => source.emit({ type: 'ready', cursor: { sessionId: 'new', revision: 0 } }))
  expect(result.current.recording).toBeNull()
  act(() => {
    source.emitRecording({ sessionId: 'session', revision: 100, state: 'pause' })
    source.emitRecording({ sessionId: 'new', revision: 0, state: 'open' })
  })
  await waitFor(() => expect(result.current.connection).toBe('live'))
  expect(result.current.recording).toEqual({ sessionId: 'new', revision: 0, state: 'open' })
})

test('malformed recording metadata never restarts logs or resets details and can recover independently', async () => {
  const { result } = renderHook(() => useLogs('', 0))
  const source = FakeEventSource.instances[0]!
  act(() => {
    source.emit({ type: 'ready', cursor: logs.cursor })
    source.emitRecording({ sessionId: 'session', revision: 1, state: 'pause' })
  })
  await waitFor(() => expect(result.current.connection).toBe('live'))
  const data = result.current.data
  const batch = result.current.batch
  act(() => source.dispatchEvent(new MessageEvent('recording', { data: '{}' })))
  expect(result.current.recordingError).toBeTruthy()
  expect(result.current.connection).toBe('live')
  expect(result.current.data).toBe(data)
  expect(result.current.batch).toBe(batch)
  expect(source.closed).toBe(false)
  expect(FakeEventSource.instances).toHaveLength(1)
  expect(fetchLogs).toHaveBeenCalledOnce()
  act(() => result.current.applyRecording({ sessionId: 'session', revision: 0, state: 'open' }))
  expect(result.current.recordingError).toBeTruthy()
  expect(result.current.recording?.state).toBe('pause')
  act(() => source.emitRecording({ sessionId: 'session', revision: 1, state: 'pause' }))
  expect(result.current.recordingError).toBeNull()
  expect(result.current.recording?.state).toBe('pause')
})
