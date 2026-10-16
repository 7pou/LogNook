import { readFile, truncate } from 'node:fs/promises'
import { get } from 'node:http'
import { beforeEach, expect, test, vi } from 'vitest'
import { resolveOptions } from '../src/config'
import { Logger } from '../src/logger'
import { LogViewer } from '../src/log-viewer'
import { HtmlServer } from '../src/viewer-server'
import { openSse, withTempDir } from './helpers'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, truncate: vi.fn(actual.truncate) }
})
beforeEach(() => vi.clearAllMocks())

test('same facade writer pushes both clients; confirmed clear resets the entire file', () => withTempDir(async (directory) => {
  const viewer = new LogViewer({ dir: directory, port: 0 })
  const { url } = await viewer.server()
  const first = await openSse(url)
  const second = await openSse(url)
  try {
    expect((await first.next()).type).toBe('ready')
    expect((await second.next()).type).toBe('ready')
    await viewer.log('keep')
    expect(await first.next()).toMatchObject({ type: 'append', cursor: { revision: 1 }, entry: { message: 'keep' } })
    expect((await second.next()).cursor.revision).toBe(1)
    const snapshot = await (await fetch(new URL('/api/logs?q=missing', url))).json() as { clearToken: string }
    const cleared = await fetch(new URL('/api/logs/clear', url), { method: 'POST', headers: { 'X-Log-Viewer-Token': snapshot.clearToken } })
    expect(await cleared.json()).toMatchObject({ cursor: { revision: 2 } })
    expect((await first.next()).type).toBe('reset')
    expect((await second.next()).type).toBe('reset')
    await viewer.log('new')
    expect((await first.next()).cursor.revision).toBe(3)
    expect(await readFile(resolveOptions({ dir: directory }).logPath, 'utf8')).not.toContain('keep')
  } finally { first.close(); second.close(); await viewer.close() }
}))

test('methods, query/body, Host, Origin and token guard destructive endpoint', () => withTempDir(async (directory) => {
  const options = resolveOptions({ dir: directory, port: 0 })
  const logger = new Logger(options.logPath)
  const service = new HtmlServer(options, directory, logger)
  try {
    const { url, port } = await service.run()
    await logger.log('protected')
    const snapshot = await (await fetch(new URL('/api/logs', url))).json() as { clearToken: string }
    for (const path of ['/api/events', '/api/logs/clear']) {
      const method = path.endsWith('clear') ? 'GET' : 'HEAD'
      expect((await fetch(new URL(path, url), { method })).status).toBe(405)
    }
    expect((await fetch(new URL('/api/events?q=x', url))).status).toBe(400)
    for (const headers of [{}, { 'X-Log-Viewer-Token': 'wrong' }, { 'X-Log-Viewer-Token': snapshot.clearToken, Origin: 'http://evil.example' }]) {
      expect((await fetch(new URL('/api/logs/clear', url), { method: 'POST', headers })).status).toBe(403)
    }
    const headers = { 'X-Log-Viewer-Token': snapshot.clearToken }
    expect((await fetch(new URL('/api/logs/clear?file=other', url), { method: 'POST', headers })).status).toBe(400)
    expect((await fetch(new URL('/api/logs/clear', url), { method: 'POST', headers, body: 'x' })).status).toBe(400)
    const status = await new Promise<number | undefined>((resolve, reject) => {
      get({ hostname: '127.0.0.1', port, path: '/api/logs', headers: { Host: 'evil.example' } }, (response) => { response.resume(); response.once('end', () => resolve(response.statusCode)) }).once('error', reject)
    })
    expect(status).toBe(403)
    expect(await logger.readSnapshot()).toMatchObject({ cursor: { revision: 1 }, total: 1 })
    const accepted = await fetch(new URL('/api/logs/clear', url), { method: 'POST', headers: { ...headers, Origin: new URL(url).origin } })
    expect(accepted.status).toBe(200)
    expect(accepted.headers.get('access-control-allow-origin')).toBeNull()
  } finally { await service.close() }
}))

test('clear failure preserves file and closed store returns 503; standalone service restarts', () => withTempDir(async (directory) => {
  const options = resolveOptions({ dir: directory, port: 0 })
  const logger = new Logger(options.logPath)
  const service = new HtmlServer(options, directory, logger)
  try {
    const { url } = await service.run()
    await logger.log('preserve')
    const snapshot = await (await fetch(new URL('/api/logs', url))).json() as { clearToken: string }
    vi.mocked(truncate).mockRejectedValueOnce(new Error('denied'))
    expect((await fetch(new URL('/api/logs/clear', url), { method: 'POST', headers: { 'X-Log-Viewer-Token': snapshot.clearToken } })).status).toBe(500)
    expect(await logger.readSnapshot()).toMatchObject({ total: 1, cursor: { revision: 1 } })
    await service.close()
    const restarted = await service.run()
    expect((await fetch(new URL('/api/logs', restarted.url))).status).toBe(200)
    logger.stopAccepting()
    expect((await fetch(new URL('/api/logs', restarted.url))).status).toBe(503)
    expect((await fetch(new URL('/api/events', restarted.url))).status).toBe(503)
  } finally { await service.close() }
}))

test('facade close terminates active SSE without waiting for client disposal', () => withTempDir(async (directory) => {
  const viewer = new LogViewer({ dir: directory, port: 0 })
  const stream = await openSse((await viewer.server()).url)
  await stream.next()
  try { await viewer.close(); await expect(viewer.log('late')).rejects.toThrow('closed') }
  finally { stream.close(); await viewer.close() }
}))

test('canonical default HTTP port accepts omitted or explicit 80 in local Host', () => withTempDir(async (directory) => {
  const service = new HtmlServer(resolveOptions({ dir: directory, port: 0 }), directory)
  try {
    const { port } = await service.run()
    for (const host of ['127.0.0.1', '127.0.0.1:80', 'localhost', 'localhost:80']) {
      const result = await new Promise<{ status: number | undefined; data: string }>((resolve, reject) => {
        get({ hostname: '127.0.0.1', port, path: '/api/logs', headers: { Host: host, Origin: host.startsWith('localhost') ? 'http://localhost' : 'http://127.0.0.1' } }, (response) => {
          let data = ''
          response.on('data', (chunk) => { data += chunk })
          response.once('end', () => resolve({ status: response.statusCode, data }))
        }).once('error', reject)
      })
      expect(result.status).toBe(200)
      expect(JSON.parse(result.data)).toMatchObject({ total: 0, clearToken: expect.any(String) })
    }
  } finally { await service.close() }
}))
