import { access, appendFile, mkdir, readFile } from 'node:fs/promises'
import { createServer, Server } from 'node:http'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { LogViewer } from '../src'
import { HtmlServer } from '../src/viewer-server'
import { withTempDir } from './helpers'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, mkdir: vi.fn(actual.mkdir), appendFile: vi.fn(actual.appendFile) }
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

test('constructor is lazy and close drains accepted writes', () => withTempDir(async (directory) => {
  const logPath = join(directory, 'nested', 'app.log')
  const viewer = new LogViewer({ dir: join(directory, 'nested'), port: 0 })
  await expect(access(logPath)).rejects.toMatchObject({ code: 'ENOENT' })
  const first = viewer.log('第一条')
  const second = viewer.log({ title: '对象', message: { id: 123 } })
  const closing = viewer.close()
  expect(viewer.close()).toBe(closing)
  await closing
  await Promise.all([first, second])
  const entries = (await readFile(logPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
  expect(entries.map((entry) => entry.message)).toEqual(['第一条', { id: 123 }])
  await expect(viewer.log('关闭后')).rejects.toThrow()
  await expect(viewer.server()).rejects.toThrow()
  await expect(viewer.close()).resolves.toBeUndefined()
}))

test('writer and viewer use one configured file and share startup', () => withTempDir(async (directory) => {
  const viewer = new LogViewer({ dir: directory, filename: 'shared.log', port: 0 })
  try {
    await viewer.log({ title: '通用内容', message: { name: 'Alice' } })
    const starting = viewer.server()
    expect(viewer.server()).toBe(starting)
    const info = await starting
    const data = await (await fetch(new URL('/api/logs?q=alice', info.url))).json()
    expect(data).toMatchObject({ filename: 'shared.log', total: 1, matched: 1 })
  } finally {
    await viewer.close()
  }
}))

test('import and construction have no filesystem or listening side effects', () => withTempDir(async (directory) => {
  const listening = vi.spyOn(Server.prototype, 'listen')
  vi.resetModules()
  const module = await import('../src')
  const viewer = new module.LogViewer({ dir: join(directory, 'unused'), port: 0 })
  expect(mkdir).not.toHaveBeenCalled()
  expect(appendFile).not.toHaveBeenCalled()
  expect(listening).not.toHaveBeenCalled()
  expect(Object.keys(module)).toEqual(['LogViewer'])
  await viewer.close()
}))

test('fixes relative directory at construction time', () => withTempDir(async (directory) => {
  const workingDirectory = vi.spyOn(process, 'cwd').mockReturnValue(directory)
  const viewer = new LogViewer({ dir: 'logs', port: 0 })
  workingDirectory.mockReturnValue(join(directory, 'other'))
  try {
    await viewer.log('original directory')
    expect(await readFile(join(directory, 'logs', 'app.log'), 'utf8')).toContain('original directory')
    await expect(access(join(directory, 'other', 'logs', 'app.log'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    workingDirectory.mockRestore()
    await viewer.close()
  }
}))

test('close waits for startup and frees the port', () => withTempDir(async (directory) => {
  const viewer = new LogViewer({ dir: directory, port: 0 })
  const starting = viewer.server()
  const closing = viewer.close()
  await expect(viewer.log('too late')).rejects.toThrow()
  await expect(viewer.server()).rejects.toThrow()
  const { port } = await starting
  await closing
  const probe = createServer()
  try {
    await new Promise<void>((resolve, reject) => {
      probe.once('error', reject)
      probe.listen(port, '127.0.0.1', resolve)
    })
  } finally {
    if (probe.listening) await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()))
  }
}))

test('drains writes even when service shutdown fails', () => withTempDir(async (directory) => {
  vi.spyOn(HtmlServer.prototype, 'close').mockRejectedValueOnce(new Error('shutdown failed'))
  const viewer = new LogViewer({ dir: directory, port: 0 })
  const writing = viewer.log('saved despite shutdown failure')
  await expect(viewer.close()).rejects.toThrow('shutdown failed')
  await writing
  expect(await readFile(join(directory, 'app.log'), 'utf8')).toContain('saved despite shutdown failure')
  await expect(viewer.log('closed')).rejects.toThrow()
}))
