import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode, createElement } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'
import type { LogsSnapshot } from '../../src/log-types'
import { fetchLogs } from './api'
import { useLogs } from './useLogs'
import { deferred, logs } from './test/fixtures'
import { FakeEventSource } from './test/fake-event-source'

vi.mock('./api', () => ({ fetchLogs: vi.fn() }))

beforeEach(() => { FakeEventSource.instances = []; vi.stubGlobal('EventSource', FakeEventSource) })
function ready(revision = 0, sessionId = 'session') {
  const source = FakeEventSource.instances.at(-1)!
  act(() => source.emit({ type: 'ready', cursor: { sessionId, revision } }))
  return source
}

test.each(['resolve', 'reject'] as const)('ignores an old request that completes with %s after the new response', async (completion) => {
  const previous = deferred<LogsSnapshot>()
  const next = deferred<LogsSnapshot>()
  vi.mocked(fetchLogs).mockReset().mockReturnValueOnce(previous.promise).mockReturnValueOnce(next.promise)
  const { result, rerender } = renderHook(({ query }) => useLogs(query, 0), { initialProps: { query: 'old' } })
  ready()
  const signal = vi.mocked(fetchLogs).mock.calls[0]![1]
  rerender({ query: 'new' })
  expect(signal.aborted).toBe(true)
  await act(async () => next.resolve({ ...logs, query: 'new' }))
  expect(result.current.data?.query).toBe('new')
  const batch = result.current.batch
  await act(async () => {
    if (completion === 'resolve') previous.resolve({ ...logs, query: 'old' })
    else previous.reject(new Error('old error'))
  })
  expect(result.current.data?.query).toBe('new')
  expect(result.current.error).toBeNull()
  expect(result.current.batch).toBe(batch)
})

test('preserves data and batch while refreshing or when refresh fails', async () => {
  const next = deferred<LogsSnapshot>()
  vi.mocked(fetchLogs).mockReset().mockResolvedValueOnce(logs).mockReturnValueOnce(next.promise)
  const { result, rerender, unmount } = renderHook(({ refresh }) => useLogs('', refresh), { initialProps: { refresh: 0 } })
  ready()
  await waitFor(() => expect(result.current.data).toEqual(logs))
  const batch = result.current.batch
  rerender({ refresh: 1 })
  ready()
  expect(result.current.loading).toBe(true)
  expect(result.current.data).toEqual(logs)
  await act(async () => next.reject(new Error('offline')))
  expect(result.current.error).toBe('offline')
  expect(result.current.data).toEqual(logs)
  expect(result.current.batch).toBe(batch)
  unmount()
  expect(vi.mocked(fetchLogs).mock.calls[1]![1].aborted).toBe(true)
})

test.each([false, true])('snapshot handshake merges a pending write once (already included: %s)', async (included) => {
  const pending = deferred<LogsSnapshot>()
  vi.mocked(fetchLogs).mockReset().mockReturnValueOnce(pending.promise)
  const { result } = renderHook(() => useLogs('', 0))
  expect(fetchLogs).not.toHaveBeenCalled()
  const source = ready()
  const entry = { kind: 'raw' as const, raw: 'during snapshot' }
  act(() => source.emit({ type: 'append', cursor: { sessionId: 'session', revision: 1 }, entry }))
  await act(async () => pending.resolve(included ? { ...logs, total: 2, matched: 2, entries: [...logs.entries, entry], cursor: { sessionId: 'session', revision: 1 } } : logs))
  expect(result.current.data).toMatchObject({ total: 2, matched: 2, cursor: { revision: 1 } })
  expect(result.current.data?.entries.filter((record) => record.kind === 'raw')).toHaveLength(1)
  expect(result.current.connection).toBe('live')
  expect(fetchLogs).toHaveBeenCalledTimes(1)
})

test('pending pre-clear snapshot never resurrects old records; late clear response preserves newer append', async () => {
  const pending = deferred<LogsSnapshot>()
  vi.mocked(fetchLogs).mockReset().mockReturnValueOnce(pending.promise)
  const { result } = renderHook(() => useLogs('', 0))
  const source = ready()
  act(() => source.emit({ type: 'reset', cursor: { sessionId: 'session', revision: 1 } }))
  await act(async () => pending.resolve(logs))
  expect(result.current.data).toMatchObject({ total: 0, entries: [], cursor: { revision: 1 } })
  const batch = result.current.batch
  act(() => source.emit({ type: 'append', cursor: { sessionId: 'session', revision: 2 }, entry: { kind: 'raw', raw: 'newer' } }))
  act(() => result.current.applyClear({ sessionId: 'session', revision: 1 }))
  expect(result.current.data).toMatchObject({ total: 1, entries: [{ raw: 'newer' }], cursor: { revision: 2 } })
  expect(result.current.batch).toBe(batch)
  expect(fetchLogs).toHaveBeenCalledOnce()
})

test('live append does not reload history; nonmatching append advances the total', async () => {
  vi.mocked(fetchLogs).mockReset().mockResolvedValue({ ...logs, query: 'Alice' })
  const { result } = renderHook(() => useLogs('Alice', 0))
  const source = ready()
  await waitFor(() => expect(result.current.connection).toBe('live'))
  const batch = result.current.batch
  act(() => {
    source.emit({ type: 'append', cursor: { sessionId: 'session', revision: 1 }, entry: { kind: 'raw', raw: 'Bob' } })
    source.emit({ type: 'append', cursor: { sessionId: 'session', revision: 2 }, entry: { kind: 'raw', raw: 'Alice new' } })
  })
  expect(result.current.data).toMatchObject({ total: 3, matched: 2, cursor: { revision: 2 } })
  expect(result.current.batch).toBe(batch)
  expect(fetchLogs).toHaveBeenCalledOnce()
})

test('query changes reuse the stream and reconnect syncs the current query and new session', async () => {
  vi.mocked(fetchLogs).mockReset().mockImplementation(async (query) => ({ ...logs, query }))
  const { result, rerender } = renderHook(({ query }) => useLogs(query, 0), { initialProps: { query: '' } })
  const source = ready()
  await waitFor(() => expect(result.current.connection).toBe('live'))
  rerender({ query: 'Bob' })
  await waitFor(() => expect(result.current.data?.query).toBe('Bob'))
  expect(FakeEventSource.instances).toHaveLength(1)
  act(() => source.disconnect())
  expect(result.current.data?.query).toBe('Bob')
  expect(result.current.connection).toBe('reconnecting')
  expect(source.closed).toBe(false)
  vi.mocked(fetchLogs).mockResolvedValueOnce({ ...logs, query: 'Bob', cursor: { sessionId: 'new-session', revision: 0 } })
  ready(0, 'new-session')
  await waitFor(() => expect(result.current.connection).toBe('live'))
  expect(result.current.data?.cursor.sessionId).toBe('new-session')
  expect(fetchLogs).toHaveBeenLastCalledWith('Bob', expect.any(AbortSignal))
})

test.each(['gap', 'resync', 'protocol'] as const)('unsafe %s restarts handshake; old connection cannot commit', async (kind) => {
  vi.mocked(fetchLogs).mockReset().mockResolvedValue(logs)
  const { result } = renderHook(() => useLogs('', 0))
  const source = ready()
  await waitFor(() => expect(result.current.connection).toBe('live'))
  act(() => {
    if (kind === 'protocol') source.dispatchEvent(new MessageEvent('append', { data: 'bad' }))
    else source.emit(kind === 'gap' ? { type: 'append', cursor: { sessionId: 'session', revision: 2 }, entry: { kind: 'raw', raw: 'unsafe' } } : { type: 'resync', cursor: { sessionId: 'session', revision: 1 } })
  })
  expect(source.closed).toBe(true)
  expect(FakeEventSource.instances).toHaveLength(2)
  act(() => source.emit({ type: 'reset', cursor: { sessionId: 'session', revision: 9 } }))
  expect(result.current.data?.total).toBe(1)
  ready()
  await waitFor(() => expect(result.current.connection).toBe('live'))
})

test('UTF8 pending buffer overflow closes old stream and aborts stale snapshot', async () => {
  const pending = deferred<LogsSnapshot>()
  vi.mocked(fetchLogs).mockReset().mockReturnValueOnce(pending.promise).mockResolvedValue(logs)
  const { result } = renderHook(() => useLogs('', 0))
  const source = ready()
  const signal = vi.mocked(fetchLogs).mock.calls[0]![1]
  act(() => {
    for (const revision of [1, 2]) source.emit({ type: 'append', cursor: { sessionId: 'session', revision }, entry: { kind: 'raw', raw: '汉'.repeat(200_000) } })
  })
  expect(source.closed).toBe(true)
  expect(signal.aborted).toBe(true)
  expect(FakeEventSource.instances).toHaveLength(2)
  ready()
  await waitFor(() => expect(result.current.connection).toBe('live'))
  await act(async () => pending.resolve({ ...logs, total: 0, matched: 0, entries: [] }))
  expect(result.current.data?.total).toBe(1)
})

test('failed sync closes stream, keeps data and manual retry obtains a new ready', async () => {
  vi.mocked(fetchLogs).mockReset().mockResolvedValueOnce(logs).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(logs)
  const { result, rerender } = renderHook(({ refresh }) => useLogs('', refresh), { initialProps: { refresh: 0 } })
  const first = ready()
  await waitFor(() => expect(result.current.connection).toBe('live'))
  act(() => first.disconnect())
  ready()
  await waitFor(() => expect(result.current.connection).toBe('error'))
  expect(result.current.data).toEqual(logs)
  expect(first.closed).toBe(true)
  rerender({ refresh: 1 })
  ready()
  await waitFor(() => expect(result.current.connection).toBe('live'))
})

test('StrictMode and unmount leave no streams or stale callbacks', async () => {
  vi.mocked(fetchLogs).mockReset().mockResolvedValue(logs)
  const { result, unmount } = renderHook(() => useLogs('', 0), { wrapper: ({ children }) => createElement(StrictMode, null, children) })
  expect(FakeEventSource.instances.filter((source) => !source.closed)).toHaveLength(1)
  ready()
  await waitFor(() => expect(result.current.connection).toBe('live'))
  unmount()
  expect(FakeEventSource.instances.every((source) => source.closed)).toBe(true)
  expect(vi.mocked(fetchLogs).mock.calls.at(-1)![1].aborted).toBe(true)
})

test('a live reset with a revision gap clears safely and requests a fresh snapshot', async () => {
  vi.mocked(fetchLogs).mockReset().mockResolvedValue(logs)
  const { result } = renderHook(() => useLogs('', 0))
  const source = ready()
  await waitFor(() => expect(result.current.connection).toBe('live'))
  act(() => source.emit({ type: 'reset', cursor: { sessionId: 'session', revision: 2 } }))
  expect(result.current.data).toMatchObject({ entries: [], total: 0 })
  expect(source.closed).toBe(true)
  expect(result.current.connection).toBe('connecting')
})

test('query snapshot freezes old results then merges buffered entries using the new query', async () => {
  const pending = deferred<LogsSnapshot>()
  vi.mocked(fetchLogs).mockReset().mockResolvedValueOnce(logs).mockReturnValueOnce(pending.promise)
  const { result, rerender } = renderHook(({ query }) => useLogs(query, 0), { initialProps: { query: '' } })
  const source = ready()
  await waitFor(() => expect(result.current.connection).toBe('live'))
  rerender({ query: 'Bob' })
  act(() => source.emit({ type: 'append', cursor: { sessionId: 'session', revision: 1 }, entry: { kind: 'raw', raw: 'Bob new' } }))
  expect(result.current.data).toEqual(logs)
  await act(async () => pending.resolve({ ...logs, query: 'Bob', matched: 0, entries: [] }))
  expect(result.current.data).toMatchObject({ query: 'Bob', total: 2, matched: 1, entries: [{ raw: 'Bob new' }] })
  expect(FakeEventSource.instances).toHaveLength(1)
})

test('a duplicate resync cursor does not reopen an already up-to-date stream', async () => {
  vi.mocked(fetchLogs).mockReset().mockResolvedValue(logs)
  const { result } = renderHook(() => useLogs('', 0))
  const source = ready()
  await waitFor(() => expect(result.current.connection).toBe('live'))
  act(() => source.emit({ type: 'resync', cursor: logs.cursor }))
  expect(source.closed).toBe(false)
  expect(result.current.connection).toBe('live')
})

test('submitting a different query after failed sync reopens the closed stream', async () => {
  vi.mocked(fetchLogs).mockReset().mockResolvedValueOnce({ ...logs, query: 'Alice' }).mockRejectedValueOnce(new Error('read denied')).mockResolvedValueOnce({ ...logs, query: 'Bob' })
  const { result, rerender } = renderHook(({ query, refresh }) => useLogs(query, refresh), { initialProps: { query: 'Alice', refresh: 0 } })
  ready()
  await waitFor(() => expect(result.current.connection).toBe('live'))
  rerender({ query: 'Alice', refresh: 1 })
  const failedSource = ready()
  await waitFor(() => expect(result.current.connection).toBe('error'))
  expect(failedSource.closed).toBe(true)
  rerender({ query: 'Bob', refresh: 1 })
  expect(FakeEventSource.instances).toHaveLength(3)
  ready()
  await waitFor(() => expect(result.current.connection).toBe('live'))
  expect(result.current.data?.query).toBe('Bob')
  expect(result.current.error).toBeNull()
  expect(fetchLogs).toHaveBeenLastCalledWith('Bob', expect.any(AbortSignal))
})
