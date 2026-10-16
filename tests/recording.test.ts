import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { LogViewer } from '../src'
import { openSse, withTempDir } from './helpers'

test('paused logs skip filtering and serialization without creating files', () => withTempDir(async (directory) => {
  const logDirectory = join(directory, 'unused')
  let filterCalls = 0
  const viewer = new LogViewer({ dir: logDirectory, filter: () => { filterCalls += 1; return true } })
  try {
    viewer.pause()
    viewer.pause()
    await expect(viewer.log('ignored')).resolves.toBeUndefined()
    await expect(viewer.log({ get message(): unknown { throw new Error('must not serialize') } })).resolves.toBeUndefined()
    await expect(viewer.log({ message: 1n })).resolves.toBeUndefined()
    expect(filterCalls).toBe(0)
    await expect(access(logDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await viewer.close() }
}))

test('resume records only future calls while accepted pre-pause writes complete in order', () => withTempDir(async (directory) => {
  const viewer = new LogViewer({ dir: directory })
  try {
    viewer.resume()
    const accepted = viewer.log('before pause')
    viewer.pause()
    await viewer.log('discarded while paused')
    viewer.resume()
    viewer.resume()
    await viewer.log({ title: 'resumed', message: 'after resume' })
    await accepted
    const records = (await readFile(join(directory, 'app.log'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
    expect(records.map((record) => record.message)).toEqual(['before pause', 'after resume'])
  } finally { await viewer.close() }
}))

test('pausing keeps the server and clear available without emitting discarded logs', () => withTempDir(async (directory) => {
  const viewer = new LogViewer({ dir: directory, port: 0 })
  let stream: Awaited<ReturnType<typeof openSse>> | undefined
  try {
    await viewer.log('before pause')
    viewer.pause()
    const serving = viewer.server()
    expect(viewer.server()).toBe(serving)
    const { url } = await serving
    stream = await openSse(url)
    expect(await stream.next()).toMatchObject({ type: 'ready', cursor: { revision: 1 } })
    await viewer.log('not pushed')
    const snapshot = await (await fetch(new URL('/api/logs', url))).json() as { clearToken: string; total: number; cursor: { revision: number } }
    expect(snapshot).toMatchObject({ total: 1, cursor: { revision: 1 } })
    const response = await fetch(new URL('/api/logs/clear', url), { method: 'POST', headers: { 'X-Log-Viewer-Token': snapshot.clearToken } })
    expect(response.status).toBe(200)
    expect(await stream.next()).toMatchObject({ type: 'reset', cursor: { revision: 2 } })
    expect(await readFile(join(directory, 'app.log'), 'utf8')).toBe('')
    await viewer.log('still paused')
    viewer.resume()
    await viewer.log('resumed and pushed')
    expect(await stream.next()).toMatchObject({ type: 'append', cursor: { revision: 3 }, entry: { message: 'resumed and pushed' } })
    expect(await (await fetch(new URL('/api/logs', url))).json()).toMatchObject({ total: 1, entries: [{ message: 'resumed and pushed' }] })
  } finally { stream?.close(); await viewer.close() }
}))

test.each(['closing', 'closed'] as const)('pause and resume cannot revive a %s instance', (state) => withTempDir(async (directory) => {
  const viewer = new LogViewer({ dir: directory, port: 0 })
  const closing = viewer.close()
  try {
    if (state === 'closed') await closing
    expect(() => viewer.pause()).toThrow('LogViewer is closed')
    expect(() => viewer.resume()).toThrow('LogViewer is closed')
    await expect(viewer.log('too late')).rejects.toThrow('LogViewer is closed')
    await expect(viewer.server()).rejects.toThrow('LogViewer is closed')
  } finally { await closing }
}))

test('close while paused drains previously accepted writes and stays closed', () => withTempDir(async (directory) => {
  const viewer = new LogViewer({ dir: directory })
  try {
    const accepted = viewer.log('accepted')
    viewer.pause()
    await viewer.log('dropped')
    const closing = viewer.close()
    expect(viewer.close()).toBe(closing)
    await closing
    await accepted
    const records = (await readFile(join(directory, 'app.log'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
    expect(records.map((record) => record.message)).toEqual(['accepted'])
    expect(() => viewer.resume()).toThrow('LogViewer is closed')
  } finally { await viewer.close() }
}))
