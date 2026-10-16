import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { createServer, get, type Server } from 'node:http'
import { beforeEach, expect, test, vi } from 'vitest'
import { resolveOptions } from '../src/config'
import { HtmlServer } from '../src/viewer-server'
import { createWebFixture, withTempDir } from './helpers'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, readFile: vi.fn(actual.readFile) }
})
beforeEach(() => vi.clearAllMocks())

function listen(server: Server, port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      if (address === null || typeof address === 'string') return reject(new Error('No TCP address'))
      resolve(address.port)
    })
  })
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

const line = (message: string) => JSON.stringify({ timestamp: '2026-10-15T02:00:00.000Z', message }) + '\n'

test('serves configured file, shares startup and sets safe response headers', () => withTempDir(async (directory) => {
  const options = resolveOptions({ dir: directory, filename: 'custom.log', port: 0 })
  await writeFile(options.logPath, line('目标消息'))
  const service = new HtmlServer(options, await createWebFixture(directory))
  try {
    const starting = service.run()
    expect(service.run()).toBe(starting)
    const info = await starting
    expect(info.port).toBeGreaterThan(0)
    expect(info.url).toBe(`http://127.0.0.1:${info.port}/`)
    const response = await fetch(info.url)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    const html = await response.text()
    expect(html).toContain('id="root"')
    expect(html).not.toContain('目标消息')
    expect(response.headers.get('content-security-policy')).toContain("script-src 'self'")
    expect(response.headers.get('content-security-policy')).not.toContain('unsafe-inline')
    const api = await fetch(new URL('/api/logs', info.url))
    expect(api.headers.get('cache-control')).toBe('no-store')
    expect(await api.json()).toMatchObject({ filename: 'custom.log', total: 1, matched: 1, entries: [{ message: '目标消息' }] })
    const asset = await fetch(new URL('/assets/index-a1b2c3d4.js', info.url))
    expect(asset.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(asset.headers.get('cache-control')).toContain('immutable')
    expect(await asset.text()).toContain('fixture')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    const head = await fetch(info.url, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
  } finally {
    await service.close()
  }
}))

test('returns empty state when file does not exist', () => withTempDir(async (directory) => {
  const service = new HtmlServer(resolveOptions({ dir: directory, port: 0 }))
  try {
    const { url } = await service.run()
    const response = await fetch(new URL('/api/logs', url))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ total: 0, matched: 0, entries: [] })
    const head = await fetch(new URL('/api/logs', url), { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
  } finally {
    await service.close()
  }
}))

test('exposes only read routes and never selects a file from query parameters', () => withTempDir(async (directory) => {
  const options = resolveOptions({ dir: directory, port: 0 })
  await writeFile(options.logPath, line('当前文件'))
  const service = new HtmlServer(options)
  try {
    const { url } = await service.run()
    expect((await fetch(url, { method: 'POST' })).status).toBe(405)
    expect((await fetch(new URL('/clear', url), { method: 'POST' })).status).toBe(404)
    expect((await fetch(new URL('/other', url))).status).toBe(404)
    expect((await fetch(new URL('/api/logs', url), { method: 'POST' })).status).toBe(405)
    expect(await (await fetch(new URL('/api/logs?file=../secret.log', url))).text()).toContain('当前文件')
  } finally {
    await service.close()
  }
}))

test('reports permission errors rather than empty logs and recovers on refresh', () => withTempDir(async (directory) => {
  const options = resolveOptions({ dir: directory, port: 0 })
  await writeFile(options.logPath, line('恢复读取'))
  const service = new HtmlServer(options)
  try {
    const { url } = await service.run()
    vi.mocked(readFile).mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }))
    const response = await fetch(new URL('/api/logs', url))
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('无法读取日志') })
    expect(await (await fetch(new URL('/api/logs', url))).text()).toContain('恢复读取')
  } finally {
    await service.close()
  }
}))

test('rereads new logs and preserves search conditions', () => withTempDir(async (directory) => {
  const options = resolveOptions({ dir: directory, port: 0 })
  await writeFile(options.logPath, line('Alice first') + '{partial\n')
  const service = new HtmlServer(options)
  try {
    const { url } = await service.run()
    const query = new URL('/api/logs?q=alice', url)
    expect(await (await fetch(query)).json()).toMatchObject({ matched: 1, total: 2 })
    await appendFile(options.logPath, line('Alice second'))
    expect(await (await fetch(query)).json()).toMatchObject({ query: 'alice', matched: 2, total: 3 })
  } finally {
    await service.close()
  }
}))

test('rejects occupied ports, closes failed starts safely and can retry', () => withTempDir(async (directory) => {
  const blocker = createServer()
  const port = await listen(blocker)
  const service = new HtmlServer(resolveOptions({ dir: directory, port }))
  try {
    await expect(service.run()).rejects.toMatchObject({ code: 'EADDRINUSE' })
    await expect(service.close()).resolves.toBeUndefined()
    await close(blocker)
    expect((await service.run()).port).toBe(port)
  } finally {
    if (blocker.listening) await close(blocker)
    await service.close()
  }
}))

test('closing during startup releases the listening port', () => withTempDir(async (directory) => {
  const service = new HtmlServer(resolveOptions({ dir: directory, port: 0 }))
  const starting = service.run()
  const closing = service.close()
  expect(service.close()).toBe(closing)
  const { port } = await starting
  await closing
  const probe = createServer()
  try {
    expect(await listen(probe, port)).toBe(port)
  } finally {
    if (probe.listening) await close(probe)
    await service.close()
  }
}))

test('missing web entry gives a build hint without breaking the API', () => withTempDir(async (directory) => {
  const service = new HtmlServer(resolveOptions({ dir: directory, port: 0 }), directory)
  try {
    const { url } = await service.run()
    const response = await fetch(url)
    expect(response.status).toBe(500)
    expect(await response.text()).toContain('pnpm run build')
    expect((await fetch(new URL('/assets/missing.js', url))).status).toBe(404)
  } finally {
    await service.close()
  }
}))

test('rejects raw traversal and encoded attacks before reading resource bytes', () => withTempDir(async (directory) => {
  const service = new HtmlServer(resolveOptions({ dir: directory, port: 0 }), await createWebFixture(directory))
  try {
    const { port } = await service.run()
    vi.mocked(readFile).mockClear()
    for (const path of ['/assets/../index.html', '/assets/%2e%2e%2fsecret.js', '/assets/%5csecret.js', '/assets/file%00.js', '/assets/%GG.js', '/src/main.tsx']) {
      const status = await new Promise<number | undefined>((resolve, reject) => {
        get({ hostname: '127.0.0.1', port, path }, (response) => {
          response.resume()
          response.once('end', () => resolve(response.statusCode))
        }).once('error', reject)
      })
      expect(status).toBe(404)
    }
    expect(readFile).not.toHaveBeenCalled()
  } finally {
    await service.close()
  }
}))
