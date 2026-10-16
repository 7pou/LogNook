import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import type { RecordingSnapshot } from '../../src/recording-protocol'
import { fetchRecording, updateRecording } from './api'
import { useRecording } from './useRecording'
import { deferred, logs } from './test/fixtures'

vi.mock('./api', () => ({ fetchRecording: vi.fn(), updateRecording: vi.fn() }))
const recording: RecordingSnapshot = { sessionId: 'session', revision: 0, state: 'open' }
beforeEach(() => {
  vi.mocked(fetchRecording).mockReset().mockResolvedValue(recording)
  vi.mocked(updateRecording).mockReset()
})

test('guards repeated synchronous clicks and waits for an authoritative response', async () => {
  const mutation = deferred<RecordingSnapshot>()
  vi.mocked(updateRecording).mockReturnValue(mutation.promise)
  const updated = vi.fn()
  const { result } = renderHook(() => useRecording(recording, logs, true, updated))
  await waitFor(() => expect(updated).toHaveBeenCalledOnce())
  updated.mockClear()
  let completion!: Promise<void>
  act(() => { completion = result.current.toggle(); void result.current.toggle() })
  expect(updateRecording).toHaveBeenCalledOnce()
  expect(updated).not.toHaveBeenCalled()
  expect(result.current.action).toBe('pause')
  await act(async () => { mutation.resolve({ ...recording, revision: 1, state: 'pause' }); await completion })
  expect(updated).toHaveBeenCalledWith({ ...recording, revision: 1, state: 'pause' })
  expect(result.current.action).toBeNull()
})

test('new session aborts old controls and ignores a late result even after re-enabling', async () => {
  const mutation = deferred<RecordingSnapshot>()
  vi.mocked(updateRecording).mockReturnValueOnce(mutation.promise)
  const updated = vi.fn()
  const nextRecording = { ...recording, sessionId: 'new' }
  const nextLogs = { ...logs, cursor: { sessionId: 'new', revision: 0 } }
  const { result, rerender, unmount } = renderHook(({ current, snapshot }) => useRecording(current, snapshot, true, updated), {
    initialProps: { current: recording, snapshot: logs },
  })
  await waitFor(() => expect(updated).toHaveBeenCalledOnce())
  act(() => { void result.current.toggle() })
  const signal = vi.mocked(updateRecording).mock.calls[0]![2]
  vi.mocked(fetchRecording).mockResolvedValue(nextRecording)
  rerender({ current: nextRecording, snapshot: nextLogs })
  expect(signal.aborted).toBe(true)
  await waitFor(() => expect(updated).toHaveBeenLastCalledWith(nextRecording))
  updated.mockClear()
  await act(async () => mutation.resolve({ ...recording, revision: 1, state: 'pause' }))
  expect(updated).not.toHaveBeenCalled()
  expect(result.current.error).toBeNull()
  const pending = deferred<RecordingSnapshot>()
  vi.mocked(updateRecording).mockReturnValueOnce(pending.promise)
  act(() => { void result.current.toggle() })
  const nextSignal = vi.mocked(updateRecording).mock.calls[1]![2]
  unmount()
  expect(nextSignal.aborted).toBe(true)
  await act(async () => pending.resolve({ ...nextRecording, revision: 1, state: 'pause' }))
  expect(updated).not.toHaveBeenCalled()
})

test('disabled/missing metadata never sends a mutation and read errors remain independent', async () => {
  vi.mocked(fetchRecording).mockRejectedValueOnce(new Error('状态不可用'))
  const updated = vi.fn()
  const { result, rerender } = renderHook(({ enabled }) => useRecording(null, logs, enabled, updated), { initialProps: { enabled: false } })
  act(() => { void result.current.toggle() })
  expect(fetchRecording).not.toHaveBeenCalled()
  expect(updateRecording).not.toHaveBeenCalled()
  rerender({ enabled: true })
  await waitFor(() => expect(result.current.error).toBe('状态不可用'))
  expect(result.current.disabled).toBe(true)
  expect(updated).not.toHaveBeenCalled()
})

test('foreign session mutation response is rejected without overwriting status', async () => {
  vi.mocked(updateRecording).mockResolvedValueOnce({ ...recording, sessionId: 'foreign', state: 'pause' })
  const updated = vi.fn()
  const { result } = renderHook(() => useRecording(recording, logs, true, updated))
  await waitFor(() => expect(updated).toHaveBeenCalledOnce())
  updated.mockClear()
  await act(async () => result.current.toggle())
  expect(updated).not.toHaveBeenCalled()
  expect(result.current.error).toContain('其他日志实例')
  expect(result.current.disabled).toBe(false)
})

test('late initial read failure cannot overwrite a successful control result', async () => {
  const status = deferred<RecordingSnapshot>()
  vi.mocked(fetchRecording).mockReturnValueOnce(status.promise)
  vi.mocked(updateRecording).mockResolvedValueOnce({ ...recording, revision: 1, state: 'pause' })
  const { result } = renderHook(() => useRecording(recording, logs, true, vi.fn()))
  await act(async () => result.current.toggle())
  await act(async () => status.reject(new Error('obsolete status error')))
  expect(result.current.error).toBeNull()
})
