import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { LogEntry } from './LogEntry'

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
