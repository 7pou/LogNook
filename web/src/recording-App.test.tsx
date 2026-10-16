import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import type { RecordingSnapshot } from '../../src/recording-protocol'
import type { ClearLogsResponse } from '../../src/log-types'
import { clearLogs, fetchLogs, fetchRecording, updateRecording } from './api'
import { deferred, logs } from './test/fixtures'
import { FakeEventSource } from './test/fake-event-source'
import App from './App'

vi.mock('./api', () => ({ fetchLogs: vi.fn(), clearLogs: vi.fn(), fetchRecording: vi.fn(), updateRecording: vi.fn() }))
const initial: RecordingSnapshot = { sessionId: 'session', revision: 0, state: 'open' }
beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
  window.history.replaceState(null, '', '/?q=Alice')
  vi.mocked(fetchLogs).mockReset().mockImplementation(async (query) => ({ ...logs, query }))
  vi.mocked(fetchRecording).mockReset().mockResolvedValue(initial)
  vi.mocked(updateRecording).mockReset()
  vi.mocked(clearLogs).mockReset().mockResolvedValue({ cursor: { sessionId: 'session', revision: 1 } })
})
function start() {
  const rendered = render(<App />)
  const source = FakeEventSource.instances[0]!
  act(() => { source.emit({ type: 'ready', cursor: logs.cursor }); source.emitRecording(initial) })
  return { source, ...rendered }
}

test('stop/resume preserves details, search, log data and the single SSE connection', async () => {
  const user = userEvent.setup()
  const { source } = start()
  const stop = await screen.findByRole('button', { name: '停止录制' })
  await waitFor(() => expect(stop).toBeEnabled())
  await user.click(screen.getByText('用户信息'))
  const details = screen.getByText('用户信息').closest('details')!
  expect(details.open).toBe(true)
  const mutation = deferred<RecordingSnapshot>()
  vi.mocked(updateRecording).mockReturnValueOnce(mutation.promise)
  await user.click(stop)
  expect(screen.getByRole('button', { name: '正在停止…' })).toBeDisabled()
  expect(updateRecording).toHaveBeenCalledWith('pause', logs.clearToken, expect.any(AbortSignal))
  act(() => source.emitRecording({ ...initial, revision: 1, state: 'pause' }))
  await act(async () => mutation.resolve({ ...initial, revision: 1, state: 'pause' }))
  expect(screen.getByRole('button', { name: '继续录制' })).toBeEnabled()
  expect(screen.getByText('已停止录制')).toBeInTheDocument()
  expect(details.open).toBe(true)
  expect(window.location.search).toBe('?q=Alice')
  expect(screen.getByRole('button', { name: '清空日志' })).toBeEnabled()
  vi.mocked(updateRecording).mockResolvedValueOnce({ ...initial, revision: 2 })
  await user.click(screen.getByRole('button', { name: '继续录制' }))
  expect(screen.getByRole('button', { name: '停止录制' })).toBeEnabled()
  expect(fetchLogs).toHaveBeenCalledOnce()
  expect(FakeEventSource.instances).toHaveLength(1)
})

test('a newer SSE state wins over a delayed action response; failure stays independent and retryable', async () => {
  const user = userEvent.setup()
  const { source } = start()
  await waitFor(() => expect(screen.getByRole('button', { name: '停止录制' })).toBeEnabled())
  const mutation = deferred<RecordingSnapshot>()
  vi.mocked(updateRecording).mockReturnValueOnce(mutation.promise)
  await user.click(screen.getByRole('button', { name: '停止录制' }))
  act(() => {
    source.emitRecording({ ...initial, revision: 1, state: 'pause' })
    source.emitRecording({ ...initial, revision: 2 })
  })
  await act(async () => mutation.resolve({ ...initial, revision: 1, state: 'pause' }))
  expect(screen.getByRole('button', { name: '停止录制' })).toBeEnabled()
  vi.mocked(updateRecording).mockRejectedValueOnce(new Error('控制失败'))
  await user.click(screen.getByRole('button', { name: '停止录制' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('控制失败')
  expect(screen.getByText('用户信息')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '停止录制' })).toBeEnabled()
  vi.mocked(updateRecording).mockResolvedValueOnce({ ...initial, revision: 3, state: 'pause' })
  await user.click(screen.getByRole('button', { name: '停止录制' }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '继续录制' })).toBeEnabled()
})

test('disconnect and unmount abort pending controls and never apply late results', async () => {
  const user = userEvent.setup()
  const { source, unmount } = start()
  await waitFor(() => expect(screen.getByRole('button', { name: '停止录制' })).toBeEnabled())
  const mutation = deferred<RecordingSnapshot>()
  vi.mocked(updateRecording).mockReturnValueOnce(mutation.promise)
  await user.click(screen.getByRole('button', { name: '停止录制' }))
  const signal = vi.mocked(updateRecording).mock.calls[0]![2]
  act(() => source.disconnect())
  expect(signal.aborted).toBe(true)
  expect(screen.getByRole('button', { name: '停止录制' })).toBeDisabled()
  await act(async () => mutation.resolve({ ...initial, revision: 1, state: 'pause' }))
  expect(screen.queryByRole('button', { name: '继续录制' })).not.toBeInTheDocument()
  unmount()
  expect(source.closed).toBe(true)
})

test('initial HTTP status cannot revert newer SSE metadata', async () => {
  const status = deferred<RecordingSnapshot>()
  vi.mocked(fetchRecording).mockReturnValueOnce(status.promise)
  const { source } = start()
  await waitFor(() => expect(fetchRecording).toHaveBeenCalledOnce())
  act(() => source.emitRecording({ ...initial, revision: 4, state: 'pause' }))
  await act(async () => status.resolve(initial))
  expect(screen.getByRole('button', { name: '继续录制' })).toBeEnabled()
})

test('clear and recording requests have independent busy state without optimistic changes', async () => {
  const user = userEvent.setup()
  start()
  await waitFor(() => expect(screen.getByRole('button', { name: '停止录制' })).toBeEnabled())
  const mutation = deferred<RecordingSnapshot>()
  const clear = deferred<ClearLogsResponse>()
  vi.mocked(updateRecording).mockReturnValueOnce(mutation.promise)
  vi.mocked(clearLogs).mockReturnValueOnce(clear.promise)
  await user.click(screen.getByRole('button', { name: '停止录制' }))
  expect(screen.getByText('录制中')).toBeInTheDocument()
  expect(screen.queryByText('已停止录制')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '清空日志' }))
  await user.click(screen.getByRole('button', { name: '确认清空' }))
  expect(screen.getByRole('button', { name: '正在清空…' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '正在停止…' })).toBeDisabled()
  await act(async () => mutation.resolve({ ...initial, revision: 1, state: 'pause' }))
  expect(screen.getByRole('button', { name: '继续录制' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '正在清空…' })).toBeDisabled()
  await act(async () => clear.resolve({ cursor: { sessionId: 'session', revision: 1 } }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '继续录制' })).toBeEnabled()
  expect(fetchLogs).toHaveBeenCalledOnce()
})

test('recording protocol errors disable only recording and preserve expanded log details', async () => {
  const user = userEvent.setup()
  const { source } = start()
  await waitFor(() => expect(screen.getByRole('button', { name: '停止录制' })).toBeEnabled())
  await user.click(screen.getByText('用户信息'))
  const details = screen.getByText('用户信息').closest('details')!
  act(() => source.dispatchEvent(new MessageEvent('recording', { data: '{}' })))
  expect(screen.getByRole('button', { name: '停止录制' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '清空日志' })).toBeEnabled()
  expect(screen.getByRole('alert')).toHaveTextContent('录制状态')
  expect(details.open).toBe(true)
  expect(fetchLogs).toHaveBeenCalledOnce()
  act(() => source.emitRecording(initial))
  expect(screen.getByRole('button', { name: '停止录制' })).toBeEnabled()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(details.open).toBe(true)
})
