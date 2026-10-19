import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import type { ClearLogsResponse, LogsSnapshot } from '../../src/log-types'
import { clearLogs, fetchLogs, fetchRecording, updateRecording } from './api'
import { deferred, logs } from './test/fixtures'
import App from './App'
import { FakeEventSource } from './test/fake-event-source'

vi.mock('./api', () => ({ fetchLogs: vi.fn(), clearLogs: vi.fn(), fetchRecording: vi.fn(), updateRecording: vi.fn() }))

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
  window.history.replaceState(null, '', '/')
  vi.mocked(fetchLogs).mockReset().mockImplementation(async (query) => ({ ...logs, query }))
  vi.mocked(clearLogs).mockReset().mockResolvedValue({ cursor: { sessionId: 'session', revision: 1 } })
  vi.mocked(fetchRecording).mockReset().mockResolvedValue({ sessionId: 'session', revision: 0, state: 'open' })
  vi.mocked(updateRecording).mockReset()
})

function ready() { act(() => FakeEventSource.instances.at(-1)!.emit({ type: 'ready', cursor: { sessionId: 'session', revision: 0 } })) }
function renderApp() { const result = render(<App />); ready(); return result }

test.each([false, true])('applies server safe-rendering mode %s to both historical and live titles', async (disableSafeRendering) => {
  vi.mocked(fetchLogs).mockResolvedValue({ ...logs, disableSafeRendering,
    entries: [{ kind: 'structured', timestamp: '2026-10-15T02:00:00Z', message: 'message', titleHtml: '<strong style="color:red">Historical title</strong>' }],
  })
  renderApp()
  const historical = await screen.findByText('Historical title')
  expect(historical.hasAttribute('style')).toBe(disableSafeRendering)
  act(() => FakeEventSource.instances[0]!.emit({
    type: 'append', cursor: { sessionId: 'session', revision: 1 },
    entry: { kind: 'structured', timestamp: '2026-10-15T02:00:00Z', message: 'live message', titleHtml: '<em style="color:blue">Live title</em>' },
  }))
  expect(screen.getByText('Live title').hasAttribute('style')).toBe(disableSafeRendering)
  act(() => FakeEventSource.instances[0]!.emit({ type: 'reset', cursor: { sessionId: 'session', revision: 2 } }))
  act(() => FakeEventSource.instances[0]!.emit({
    type: 'append', cursor: { sessionId: 'session', revision: 3 },
    entry: { kind: 'structured', timestamp: '2026-10-15T02:00:00Z', message: 'after reset', titleHtml: '<em style="color:blue">After reset</em>' },
  }))
  expect(screen.getByText('After reset').hasAttribute('style')).toBe(disableSafeRendering)
})

const coloredLogs = {
  ...logs, total: 4, matched: 4, colors: ['red', 'blue'],
  entries: [
    { kind: 'structured' as const, timestamp: '2026-10-15T02:00:00Z', title: 'Red log', color: 'red', message: 'Alice' },
    { kind: 'structured' as const, timestamp: '2026-10-15T02:00:00Z', title: 'Blue log', color: 'blue', message: 'Bob' },
    { kind: 'structured' as const, timestamp: '2026-10-15T02:00:00Z', title: 'Plain log', message: 'plain' },
    { kind: 'raw' as const, raw: 'raw log' },
  ],
}

test.each(['white', 'transparent'])('keeps the selected center circle distinguishable for %s', async (color) => {
  const user = userEvent.setup()
  vi.mocked(fetchLogs).mockResolvedValue({ ...coloredLogs, colors: [color] })
  renderApp()
  const button = await screen.findByRole('button', { name: `筛选颜色 ${color}` })
  await user.click(button)
  const dot = button.firstElementChild!.firstElementChild!
  expect(getComputedStyle(dot).outline).toBe('1px solid #94a3b8')
})

test('shows color rings, adds a center dot on selection and supports multiple colors and clearing', async () => {
  const user = userEvent.setup()
  vi.mocked(fetchLogs).mockResolvedValue(coloredLogs)
  renderApp()
  const red = await screen.findByRole('button', { name: '筛选颜色 red' })
  const blue = screen.getByRole('button', { name: '筛选颜色 blue' })
  expect(red).toHaveAttribute('aria-pressed', 'false')
  expect(getComputedStyle(red.firstElementChild!).borderColor).toBe('rgb(255, 0, 0)')
  expect(red.firstElementChild!.children).toHaveLength(0)
  expect(screen.getByText('匹配 4 / 共 4 条')).toBeInTheDocument()
  const calls = vi.mocked(fetchLogs).mock.calls.length
  await user.click(red)
  expect(red).toHaveAttribute('aria-pressed', 'true')
  expect(getComputedStyle(red.firstElementChild!.firstElementChild!).backgroundColor).toBe('rgb(255, 0, 0)')
  expect(screen.getByText('Red log')).toBeInTheDocument()
  expect(screen.queryByText('Blue log')).not.toBeInTheDocument()
  expect(screen.queryByText('Plain log')).not.toBeInTheDocument()
  expect(screen.getByText('匹配 1 / 共 4 条')).toBeInTheDocument()
  blue.focus()
  await user.keyboard('[Space]')
  expect(blue).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByText('Blue log')).toBeInTheDocument()
  expect(screen.getByText('匹配 2 / 共 4 条')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '清空颜色' }))
  expect(red).toHaveAttribute('aria-pressed', 'false')
  expect(screen.getByText('Plain log')).toBeInTheDocument()
  expect(screen.getByText('匹配 4 / 共 4 条')).toBeInTheDocument()
  await user.click(red)
  await user.click(red)
  expect(screen.getByText('匹配 4 / 共 4 条')).toBeInTheDocument()
  expect(fetchLogs).toHaveBeenCalledTimes(calls)
})

test('combines colors with submitted search while retaining all color options and the selection', async () => {
  const user = userEvent.setup()
  vi.mocked(fetchLogs).mockImplementation(async (query) => query
    ? { ...coloredLogs, query, matched: 1, entries: [coloredLogs.entries[0]!] }
    : coloredLogs)
  renderApp()
  await user.click(await screen.findByRole('button', { name: '筛选颜色 blue' }))
  await user.type(screen.getByRole('searchbox', { name: '关键词' }), 'Alice')
  expect(screen.getByText('Blue log')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '搜索' }))
  expect(await screen.findByText('没有匹配的日志')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '筛选颜色 red' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '筛选颜色 blue' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByText('匹配 0 / 共 4 条')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '清空搜索' }))
  expect(await screen.findByText('Blue log')).toBeInTheDocument()
  expect(screen.queryByText('Red log')).not.toBeInTheDocument()
})

test('discovers live colors without widening the current filter and retains expanded entry identity', async () => {
  const user = userEvent.setup()
  vi.mocked(fetchLogs).mockResolvedValue(coloredLogs)
  const { container } = renderApp()
  await user.click(await screen.findByText('Blue log'))
  const expanded = container.querySelectorAll('details')[1]!
  expect(expanded.open).toBe(true)
  await user.click(screen.getByRole('button', { name: '筛选颜色 blue' }))
  expect(container.querySelector('details')).toBe(expanded)
  expect(expanded.open).toBe(true)
  act(() => FakeEventSource.instances[0]!.emit({
    type: 'append', cursor: { sessionId: 'session', revision: 1 },
    entry: { kind: 'structured', timestamp: '2026-10-15T02:00:00Z', title: 'Green log', color: 'green', message: 'new' },
  }))
  expect(screen.getByRole('button', { name: '筛选颜色 green' })).toHaveAttribute('aria-pressed', 'false')
  expect(screen.queryByText('Green log')).not.toBeInTheDocument()
  expect(screen.getByText('匹配 1 / 共 5 条')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '筛选颜色 green' }))
  expect(screen.getByText('Green log')).toBeInTheDocument()
  expect(screen.getByText('匹配 2 / 共 5 条')).toBeInTheDocument()
  expect(expanded.open).toBe(true)
})

test('preserves selected colors through resync and reset while removing unused color options', async () => {
  const user = userEvent.setup()
  vi.mocked(fetchLogs).mockResolvedValue(coloredLogs)
  renderApp()
  await user.click(await screen.findByRole('button', { name: '筛选颜色 red' }))
  await user.click(screen.getByRole('button', { name: '重新同步' }))
  ready()
  await waitFor(() => expect(screen.getByText('实时连接')).toBeInTheDocument())
  expect(screen.getByRole('button', { name: '筛选颜色 red' })).toHaveAttribute('aria-pressed', 'true')
  act(() => FakeEventSource.instances.at(-1)!.emit({ type: 'reset', cursor: { sessionId: 'session', revision: 1 } }))
  expect(screen.getByText('暂无日志')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '筛选颜色 red' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.queryByRole('button', { name: '筛选颜色 blue' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '清空颜色' }))
  expect(screen.queryByRole('button', { name: '筛选颜色 red' })).not.toBeInTheDocument()
})

test('mounts the generic log viewer and loads logs', async () => {
  renderApp()
  expect(screen.getByRole('heading', { name: 'LogNook 日志查看器' })).toBeInTheDocument()
  expect(await screen.findByText('用户信息')).toBeInTheDocument()
  expect(within(document.querySelector('header')!).getByText('custom.log')).toBeVisible()
  expect(screen.getByText('匹配 1 / 共 1 条')).toBeInTheDocument()
})

test('time visibility is local, keyboard-accessible and applies to live entries without resetting details or requests', async () => {
  const user = userEvent.setup()
  const { container } = renderApp()
  const toggle = await screen.findByRole('checkbox', { name: '显示时间' })
  expect(toggle).toBeChecked()
  expect(container.querySelectorAll('time')).toHaveLength(1)
  await user.click(screen.getByText('用户信息'))
  const details = container.querySelector('details')!
  const calls = vi.mocked(fetchLogs).mock.calls.length
  const location = window.location.href
  await user.click(toggle)
  expect(toggle).not.toBeChecked()
  expect(container.querySelectorAll('time')).toHaveLength(0)
  expect(details.open).toBe(true)
  expect(container.querySelector('details')).toBe(details)
  expect(fetchLogs).toHaveBeenCalledTimes(calls)
  expect(FakeEventSource.instances).toHaveLength(1)
  expect(window.location.href).toBe(location)
  act(() => FakeEventSource.instances[0]!.emit({
    type: 'append', cursor: { sessionId: 'session', revision: 1 },
    entry: { kind: 'structured', timestamp: '2026-10-16T02:00:00Z', title: '实时新增', message: 'live message' },
  }))
  expect(screen.getByText('实时新增')).toBeInTheDocument()
  expect(container.querySelectorAll('time')).toHaveLength(0)
  expect(details.open).toBe(true)
  toggle.focus()
  await user.keyboard('[Space]')
  expect(toggle).toBeChecked()
  expect(container.querySelectorAll('time')).toHaveLength(2)
  expect(details.open).toBe(true)
  expect(fetchLogs).toHaveBeenCalledTimes(calls)
})

test('time visibility survives search and synchronization but defaults to visible on a new page mount', async () => {
  const user = userEvent.setup()
  const { container, unmount } = renderApp()
  const toggle = await screen.findByRole('checkbox', { name: '显示时间' })
  await user.click(toggle)
  await user.type(screen.getByRole('searchbox', { name: '关键词' }), 'Alice')
  await user.click(screen.getByRole('button', { name: '搜索' }))
  await waitFor(() => expect(fetchLogs).toHaveBeenLastCalledWith('Alice', expect.any(AbortSignal)))
  expect(toggle).not.toBeChecked()
  expect(container.querySelector('time')).toBeNull()
  await user.click(screen.getByRole('button', { name: '重新同步' }))
  ready()
  await waitFor(() => expect(screen.getByText('实时连接')).toBeInTheDocument())
  expect(toggle).not.toBeChecked()
  expect(container.querySelector('time')).toBeNull()
  unmount()
  const next = renderApp()
  expect(await screen.findByRole('checkbox', { name: '显示时间' })).toBeChecked()
  expect(next.container.querySelectorAll('time')).toHaveLength(1)
})

test('groups global controls and recording status separately from search actions', async () => {
  renderApp()
  const toolbar = screen.getByRole('region', { name: '日志工具栏' })
  const actions = within(toolbar).getByRole('group', { name: '全局操作' })
  const search = within(toolbar).getByRole('search', { name: '日志搜索' })
  const status = within(toolbar).getByRole('group', { name: '日志状态' })
  expect(within(actions).getAllByRole('button').map(button => button.textContent)).toEqual(['重新同步', '停止录制', '清空日志'])
  expect(within(search).getAllByRole('button').map(button => button.textContent)).toEqual(['搜索', '清空搜索'])
  expect(within(search).getByRole('searchbox', { name: '关键词' })).toBeInTheDocument()
  expect(within(search).queryByRole('button', { name: '重新同步' })).not.toBeInTheDocument()
  expect(within(actions).queryByText('录制中')).not.toBeInTheDocument()
  await waitFor(() => expect(within(status).getByText('录制中')).toBeInTheDocument())
  expect(within(status).getByText('实时连接')).toBeInTheDocument()
  expect(actions.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
})

test('recording errors appear below the toolbar without displacing action controls', async () => {
  const user = userEvent.setup()
  renderApp()
  const stop = screen.getByRole('button', { name: '停止录制' })
  await waitFor(() => expect(stop).toBeEnabled())
  vi.mocked(updateRecording).mockRejectedValueOnce(new Error('录制控制失败'))
  await user.click(stop)
  const alert = await screen.findByRole('alert')
  const toolbar = screen.getByRole('region', { name: '日志工具栏' })
  expect(alert).toHaveTextContent('录制控制失败')
  expect(toolbar).not.toContainElement(alert)
  expect(toolbar.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
  expect(within(toolbar).getByRole('button', { name: '停止录制' })).toBeEnabled()
  expect(within(toolbar).getByRole('button', { name: '清空日志' })).toBeEnabled()
  expect(within(toolbar).getByText('录制中')).toBeInTheDocument()
})

test('loads URL query but does not request a draft until submitted', async () => {
  window.history.replaceState(null, '', '/?q=alice')
  const user = userEvent.setup()
  renderApp()
  await screen.findByText('用户信息')
  expect(fetchLogs).toHaveBeenLastCalledWith('alice', expect.any(AbortSignal))
  const input = screen.getByRole('searchbox', { name: '关键词' })
  expect(input).toHaveValue('alice')
  await user.clear(input)
  await user.type(input, ' Bob ')
  expect(fetchLogs).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: '搜索' }))
  await waitFor(() => expect(fetchLogs).toHaveBeenLastCalledWith('Bob', expect.any(AbortSignal)))
  expect(new URL(window.location.href).searchParams.get('q')).toBe('Bob')
  expect(input).toHaveValue('Bob')
  expect(FakeEventSource.instances).toHaveLength(1)
  await user.type(input, ' draft')
  await user.click(screen.getByRole('button', { name: '重新同步' }))
  ready()
  await waitFor(() => expect(fetchLogs).toHaveBeenCalledTimes(3))
  expect(fetchLogs).toHaveBeenLastCalledWith('Bob', expect.any(AbortSignal))
  await user.click(screen.getByRole('button', { name: '清空搜索' }))
  await waitFor(() => expect(fetchLogs).toHaveBeenLastCalledWith('', expect.any(AbortSignal)))
  expect(input).toHaveValue('')
  expect(window.location.search).toBe('')
})

test('distinguishes initial loading, empty logs and no matching results', async () => {
  const initial = deferred<LogsSnapshot>()
  vi.mocked(fetchLogs).mockReturnValueOnce(initial.promise)
  const user = userEvent.setup()
  renderApp()
  expect(screen.getByRole('status')).toHaveTextContent('正在读取日志')
  expect(screen.getByRole('button', { name: '清空日志' })).toBeDisabled()
  await act(async () => initial.resolve({ ...logs, total: 0, matched: 0, entries: [] }))
  expect(await screen.findByText('暂无日志')).toBeInTheDocument()
  vi.mocked(fetchLogs).mockResolvedValueOnce({ ...logs, total: 3, matched: 0, entries: [] })
  await user.click(screen.getByRole('button', { name: '重新同步' }))
  ready()
  expect(await screen.findByText('没有匹配的日志')).toBeInTheDocument()
})

test('keeps previous logs after a failed refresh and allows retry', async () => {
  const user = userEvent.setup()
  renderApp()
  await screen.findByText('用户信息')
  vi.mocked(fetchLogs).mockRejectedValueOnce(new Error('权限不足'))
  await user.click(screen.getByRole('button', { name: '重新同步' }))
  ready()
  expect(await screen.findByRole('alert')).toHaveTextContent('权限不足')
  expect(screen.getByText('用户信息')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '重试' }))
  ready()
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(screen.getByText('用户信息')).toBeInTheDocument()
})

test('handles initial errors without presenting empty logs', async () => {
  vi.mocked(fetchLogs).mockRejectedValueOnce(new Error('网络连接失败'))
  renderApp()
  expect(await screen.findByRole('alert')).toHaveTextContent('网络连接失败')
  expect(screen.queryByText('暂无日志')).not.toBeInTheDocument()
})

test('restores search when browser history changes', async () => {
  renderApp()
  await screen.findByText('用户信息')
  act(() => {
    window.history.replaceState(null, '', '/?q=previous')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await waitFor(() => expect(fetchLogs).toHaveBeenLastCalledWith('previous', expect.any(AbortSignal)))
  expect(screen.getByRole('searchbox')).toHaveValue('previous')
})

test('duplicate records have stable keys and details reset on a successful batch', async () => {
  vi.mocked(fetchLogs).mockResolvedValue({ ...logs, total: 2, matched: 2, entries: [logs.entries[0]!, logs.entries[0]!] })
  const consoleError = vi.spyOn(console, 'error')
  const user = userEvent.setup()
  const { container } = renderApp()
  await screen.findAllByText('用户信息')
  const details = container.querySelector('details')!
  await user.click(details.querySelector('summary')!)
  expect(details.open).toBe(true)
  await user.click(screen.getByRole('button', { name: '重新同步' }))
  ready()
  await waitFor(() => expect(container.querySelector('details')!.open).toBe(false))
  expect(consoleError).not.toHaveBeenCalled()
})

test('live append preserves expanded details and does not fetch history', async () => {
  const user = userEvent.setup()
  const { container } = renderApp()
  await screen.findByText('用户信息')
  const details = container.querySelector('details')!
  await user.click(details.querySelector('summary')!)
  act(() => FakeEventSource.instances.at(-1)!.emit({ type: 'append', cursor: { sessionId: 'session', revision: 1 }, entry: { kind: 'raw', raw: 'added' } }))
  expect(container.querySelector('details')).toBe(details)
  expect(details.open).toBe(true)
  expect(screen.getByText('匹配 2 / 共 2 条')).toBeInTheDocument()
  expect(fetchLogs).toHaveBeenCalledOnce()
})

test('clear confirms once, preserves search, and a delayed HTTP reset cannot remove newer records', async () => {
  window.history.replaceState(null, '', '/?q=Alice')
  const pending = deferred<ClearLogsResponse>()
  vi.mocked(clearLogs).mockReturnValueOnce(pending.promise)
  const user = userEvent.setup()
  renderApp()
  await screen.findByText('用户信息')
  await user.click(screen.getByRole('button', { name: '清空日志' }))
  expect(clearLogs).not.toHaveBeenCalled()
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认清空' }))
  expect(screen.getByText('用户信息')).toBeInTheDocument()
  act(() => {
    const source = FakeEventSource.instances.at(-1)!
    source.emit({ type: 'reset', cursor: { sessionId: 'session', revision: 1 } })
    source.emit({ type: 'append', cursor: { sessionId: 'session', revision: 2 }, entry: { kind: 'structured', timestamp: '2026-10-16T00:00:00Z', title: '清空后', message: 'Alice keep' } })
  })
  await act(async () => pending.resolve({ cursor: { sessionId: 'session', revision: 1 } }))
  expect(screen.getByText('清空后')).toBeInTheDocument()
  expect(screen.getByText('匹配 1 / 共 1 条')).toBeInTheDocument()
  expect(screen.getByRole('searchbox')).toHaveValue('Alice')
  expect(clearLogs).toHaveBeenCalledOnce()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('failed clear keeps records, shows a separate retryable error, and disconnect disables clear', async () => {
  const user = userEvent.setup()
  vi.mocked(clearLogs).mockRejectedValueOnce(new Error('clear denied'))
  renderApp()
  await screen.findByText('用户信息')
  await user.click(screen.getByRole('button', { name: '清空日志' }))
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认清空' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('clear denied')
  expect(screen.getByText('用户信息')).toBeInTheDocument()
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }))
  act(() => FakeEventSource.instances.at(-1)!.disconnect())
  expect(screen.getByText('连接中断，正在重连…')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '清空日志' })).toBeDisabled()
  expect(screen.getByText('用户信息')).toBeInTheDocument()
})
