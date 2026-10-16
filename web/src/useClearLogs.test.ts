import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import type { ClearLogsResponse } from '../../src/log-types'
import { clearLogs } from './api'
import { useClearLogs } from './useClearLogs'
import { deferred, logs } from './test/fixtures'

vi.mock('./api', () => ({ clearLogs: vi.fn() }))
beforeEach(() => vi.mocked(clearLogs).mockReset())

test('gates unavailable clear, prevents duplicate submission, and applies server cursor only on success', async () => {
  const pending = deferred<ClearLogsResponse>()
  vi.mocked(clearLogs).mockReturnValueOnce(pending.promise)
  const cleared = vi.fn()
  const { result, rerender } = renderHook(({ enabled }) => useClearLogs(logs, enabled, cleared), { initialProps: { enabled: false } })
  await act(async () => { expect(await result.current.clear()).toBe(false) })
  expect(clearLogs).not.toHaveBeenCalled()
  rerender({ enabled: true })
  let clearing!: Promise<boolean>
  act(() => { clearing = result.current.clear() })
  expect(result.current.clearing).toBe(true)
  expect(cleared).not.toHaveBeenCalled()
  await act(async () => { expect(await result.current.clear()).toBe(false) })
  await act(async () => { pending.resolve({ cursor: { sessionId: 'session', revision: 1 } }); expect(await clearing).toBe(true) })
  expect(clearLogs).toHaveBeenCalledOnce()
  expect(cleared).toHaveBeenCalledWith({ sessionId: 'session', revision: 1 })
  expect(result.current.clearing).toBe(false)
})

test('clear errors are independent and retryable without applying a fake reset', async () => {
  vi.mocked(clearLogs).mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce({ cursor: { sessionId: 'session', revision: 1 } })
  const cleared = vi.fn()
  const { result } = renderHook(() => useClearLogs(logs, true, cleared))
  await act(async () => { expect(await result.current.clear()).toBe(false) })
  expect(result.current.error).toBe('denied')
  expect(cleared).not.toHaveBeenCalled()
  await act(async () => { expect(await result.current.clear()).toBe(true) })
  expect(result.current.error).toBeNull()
  expect(cleared).toHaveBeenCalledOnce()
})

test.each(['session', 'unmount'] as const)('ignores a late clear after %s change even when network cancellation is ignored', async (change) => {
  const pending = deferred<ClearLogsResponse>()
  vi.mocked(clearLogs).mockReturnValueOnce(pending.promise)
  const cleared = vi.fn()
  const { result, rerender, unmount } = renderHook(({ sessionId }) => useClearLogs({ ...logs, cursor: { sessionId, revision: 0 } }, true, cleared), { initialProps: { sessionId: 'session' } })
  let clearing!: Promise<boolean>
  act(() => { clearing = result.current.clear() })
  const signal = vi.mocked(clearLogs).mock.calls[0]![1]
  if (change === 'session') rerender({ sessionId: 'new' })
  else unmount()
  expect(signal.aborted).toBe(true)
  await act(async () => { pending.resolve({ cursor: logs.cursor }); expect(await clearing).toBe(false) })
  expect(cleared).not.toHaveBeenCalled()
})
