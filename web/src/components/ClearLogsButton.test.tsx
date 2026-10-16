import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { ClearLogsButton } from './ClearLogsButton'

test('cancel does not clear and confirmation states full-file irreversible scope and restores focus', async () => {
  const confirm = vi.fn().mockResolvedValue(true)
  const user = userEvent.setup()
  render(<ClearLogsButton filename="custom.log" disabled={false} clearing={false} error={null} onConfirm={confirm} />)
  const opener = screen.getByRole('button', { name: '清空日志' })
  await user.click(opener)
  const dialog = screen.getByRole('dialog', { name: '清空日志确认' })
  expect(dialog).toHaveTextContent('custom.log')
  expect(dialog).toHaveTextContent('全部日志')
  expect(dialog).toHaveTextContent('不可恢复')
  const cancel = within(dialog).getByRole('button', { name: '取消' })
  expect(cancel).toHaveFocus()
  await user.click(cancel)
  expect(confirm).not.toHaveBeenCalled()
  expect(opener).toHaveFocus()
  await user.click(opener)
  await user.click(within(dialog).getByRole('button', { name: '确认清空' }))
  expect(confirm).toHaveBeenCalledOnce()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(opener).toHaveFocus()
})

test('pending blocks repeat confirmation and Escape; failure stays open for retry', async () => {
  const user = userEvent.setup()
  const confirm = vi.fn().mockResolvedValue(false)
  const { rerender } = render(<ClearLogsButton disabled={false} clearing={false} error={null} onConfirm={confirm} />)
  await user.click(screen.getByRole('button', { name: '清空日志' }))
  const dialog = screen.getByRole('dialog')
  await user.click(within(dialog).getByRole('button', { name: '确认清空' }))
  rerender(<ClearLogsButton disabled clearing error={null} onConfirm={confirm} />)
  expect(within(dialog).getByRole('button', { name: '取消' })).toBeDisabled()
  expect(within(dialog).getByRole('button', { name: '正在清空…' })).toBeDisabled()
  const escape = new Event('cancel', { cancelable: true })
  dialog.dispatchEvent(escape)
  expect(escape.defaultPrevented).toBe(true)
  rerender(<ClearLogsButton disabled={false} clearing={false} error="权限不足" onConfirm={confirm} />)
  expect(within(dialog).getByRole('alert')).toHaveTextContent('权限不足')
  expect(within(dialog).getByRole('button', { name: '确认清空' })).toBeEnabled()
})
