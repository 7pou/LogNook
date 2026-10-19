import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { deferred } from '../test/fixtures'
import { LogEntry } from './LogEntry'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

test('formats structured detail, renders title as text and uses browser-local time', async () => {
  const timestamp = '2026-10-15T02:00:00Z'
  const { container } = render(<LogEntry entry={{ kind: 'structured', timestamp, title: '<script>bad()</script>', message: { name: 'Alice' } }} />)
  expect(screen.getByText('<script>bad()</script>')).toBeInTheDocument()
  expect(container.querySelector('script')).toBeNull()
  expect(container.querySelector('time')).toHaveTextContent(new Date(timestamp).toLocaleString())
  expect(container.querySelector('pre')?.textContent).toBe('{\n  "name": "Alice"\n}')
  await userEvent.setup().click(container.querySelector('summary')!)
  expect(container.querySelector('details')!.open).toBe(true)
})

test.each([
  { kind: 'raw' as const, raw: '<img src=x onerror=bad()>\nsecond line' },
  { kind: 'structured' as const, timestamp: '2026-10-15T02:00:00Z', message: '<img src=x onerror=bad()>\nsecond line' },
])('preserves multiline text without HTML interpretation', (entry) => {
  const { container } = render(<LogEntry entry={entry} />)
  expect(container.querySelector('pre')?.textContent).toBe('<img src=x onerror=bad()>\nsecond line')
  expect(container.querySelector('img')).toBeNull()
})

test.each([null, [1, 2], false, 42])('formats JSON message %j', (message) => {
  const { container } = render(<LogEntry entry={{ kind: 'structured', timestamp: '2026-10-15T02:00:00Z', message }} />)
  expect(container.querySelector('pre')?.textContent).toBe(JSON.stringify(message, null, 2))
})

test.each([
  { kind: 'structured' as const, timestamp: '2026-10-15T02:00:00Z', title: '用户信息', message: 'message' },
  { kind: 'raw' as const, raw: 'raw message' },
])('hides the time column and keeps the same expanded entry when toggling visibility for $kind', async (entry) => {
  const { container, rerender } = render(<LogEntry entry={entry} />)
  const details = container.querySelector('details')!
  const summary = container.querySelector('summary')!
  await userEvent.setup().click(summary)
  expect(details.open).toBe(true)
  rerender(<LogEntry entry={entry} showTime={false} />)
  expect(container.querySelector('time')).toBeNull()
  expect(screen.queryByText('原始记录')).not.toBeInTheDocument()
  expect(summary.children).toHaveLength(3)
  expect(container.querySelector('details')).toBe(details)
  expect(details.open).toBe(true)
  expect(container.querySelector('pre')?.textContent).toBe(entry.kind === 'raw' ? entry.raw : entry.message)
  rerender(<LogEntry entry={entry} showTime />)
  expect(summary.children).toHaveLength(4)
  expect(details.open).toBe(true)
})

test.each([
  { name: 'multiline string', entry: { kind: 'structured' as const, timestamp: '2026-10-15T02:00:00Z', message: '  first line\n    second line  ' }, expected: '  first line\n    second line  ' },
  { name: 'JSON object', entry: { kind: 'structured' as const, timestamp: '2026-10-15T02:00:00Z', message: { name: 'Alice', count: 2 } }, expected: '{\n  "name": "Alice",\n  "count": 2\n}' },
  { name: 'raw log', entry: { kind: 'raw' as const, raw: '<img src=x>\nsecond line' }, expected: '<img src=x>\nsecond line' },
  { name: 'null', entry: { kind: 'structured' as const, timestamp: '2026-10-15T02:00:00Z', message: null }, expected: 'null' },
])('copies the full $name message without expanding the log', async ({ entry, expected }) => {
  const user = userEvent.setup()
  const { container } = render(<LogEntry entry={entry} />)
  const copyButton = screen.getByRole('button', { name: '复制消息' })
  expect(copyButton.querySelector('svg')).not.toBeNull()
  await user.click(copyButton)
  expect(await navigator.clipboard.readText()).toBe(expected)
  expect(await screen.findByRole('status')).toHaveTextContent('已复制')
  expect(container.querySelector('details')!.open).toBe(false)
})

test('supports keyboard copying without collapsing an expanded log with hidden time', async () => {
  const user = userEvent.setup()
  const { container } = render(<LogEntry entry={{ kind: 'raw', raw: 'keyboard copy' }} showTime={false} />)
  await user.click(container.querySelector('summary')!)
  const copyButton = screen.getByRole('button', { name: '复制消息' })
  copyButton.focus()
  await user.keyboard('{Enter}')
  expect(await navigator.clipboard.readText()).toBe('keyboard copy')
  expect(container.querySelector('details')!.open).toBe(true)
})

test('reports clipboard rejection and allows a successful retry', async () => {
  const user = userEvent.setup()
  const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('Permission denied'))
  render(<LogEntry entry={{ kind: 'raw', raw: 'retry copy' }} />)
  const copyButton = screen.getByRole('button', { name: '复制消息' })
  await user.click(copyButton)
  expect(await screen.findByRole('status')).toHaveTextContent('复制失败')
  expect(copyButton).toBeEnabled()
  writeText.mockRestore()
  await user.click(copyButton)
  expect(await navigator.clipboard.readText()).toBe('retry copy')
  expect(screen.getByRole('status')).toHaveTextContent('已复制')
})

test('disables the copy button while clipboard access is pending', async () => {
  const user = userEvent.setup()
  const pending = deferred<void>()
  const originalWrite = navigator.clipboard.writeText.bind(navigator.clipboard)
  vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(async (text) => {
    await pending.promise
    await originalWrite(text)
  })
  render(<LogEntry entry={{ kind: 'raw', raw: 'pending copy' }} />)
  const copyButton = screen.getByRole('button', { name: '复制消息' })
  await user.click(copyButton)
  expect(copyButton).toBeDisabled()
  expect(copyButton).toHaveAttribute('aria-busy', 'true')
  await act(async () => pending.resolve())
  expect(await navigator.clipboard.readText()).toBe('pending copy')
  expect(copyButton).toBeEnabled()
})

test('shows a recoverable error when the browser has no clipboard API', async () => {
  const user = userEvent.setup()
  vi.stubGlobal('navigator', Object.create(navigator, { clipboard: { value: undefined } }))
  render(<LogEntry entry={{ kind: 'raw', raw: 'manual copy' }} />)
  const copyButton = screen.getByRole('button', { name: '复制消息' })
  await user.click(copyButton)
  expect(await screen.findByRole('status')).toHaveTextContent('复制失败')
  expect(copyButton).toBeEnabled()
})
