import { copyFile, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import webpack from 'webpack'
import { expect, test } from 'vitest'
import type { LogViewer } from '../../src/log-viewer'
import { withTempDir } from '../helpers'

const require = createRequire(import.meta.url)
const packageEntry = new URL('../../dist/index.mjs', import.meta.url)
const webRoot = new URL('../../dist/web/', import.meta.url)

async function assertWebResources(viewer: LogViewer): Promise<void> {
  try {
    await viewer.log('standalone package message')
    const { url } = await viewer.server()
    const response = await fetch(url)
    const html = await response.text()
    expect(response.status).toBe(200)
    expect(html).toBe(await readFile(new URL('index.html', webRoot), 'utf8'))
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toContain("script-src 'self'")
    const assetPaths = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map((match) => match[1]!)
    expect(assetPaths.some((pathname) => pathname.endsWith('.js'))).toBe(true)
    expect(assetPaths.some((pathname) => pathname.endsWith('.css'))).toBe(true)
    for (const pathname of assetPaths) {
      const asset = await fetch(new URL(pathname, url))
      expect(asset.status).toBe(200)
      expect(await asset.text()).toBe(await readFile(new URL(pathname.slice(1), webRoot), 'utf8'))
      expect(asset.headers.get('content-type')).toBe(pathname.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8')
      expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
      const head = await fetch(new URL(pathname, url), { method: 'HEAD' })
      expect(head.status).toBe(200)
      expect(head.headers.get('content-type')).toBe(asset.headers.get('content-type'))
      expect(head.headers.get('cache-control')).toBe(asset.headers.get('cache-control'))
      expect(await head.text()).toBe('')
    }
    const head = await fetch(url, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
    expect((await fetch(url, { method: 'POST' })).status).toBe(405)
    for (const pathname of ['/assets/missing.js', '/assets/%2e%2e%2fsecret.js', '/assets/%5csecret.js', '/assets/%GG.js', '/src/index.ts']) {
      expect((await fetch(new URL(pathname, url))).status).toBe(404)
    }
    const snapshot = await (await fetch(new URL('/api/logs', url))).json()
    expect(snapshot).toMatchObject({ total: 1, entries: [{ message: 'standalone package message' }] })
  } finally {
    await viewer.close()
  }
}

test('the standalone ESM package serves embedded web resources without a web directory', () => withTempDir(async (directory) => {
  const entry = join(directory, 'viewer.mjs')
  await copyFile(packageEntry, entry)
  const { LogViewer } = await import(pathToFileURL(entry).href)
  await assertWebResources(new LogViewer({ dir: directory, port: 0 }))
}))

test('a production CommonJS bundle serves embedded web resources without custom Webpack configuration', () => withTempDir(async (directory) => {
  const entry = join(directory, 'input.mjs')
  await copyFile(packageEntry, entry)
  const compiler = webpack({
    mode: 'production',
    target: 'node',
    entry,
    output: { path: join(directory, 'bundle'), filename: 'viewer.cjs', library: { type: 'commonjs2' } },
  })
  try {
    const stats = await new Promise<webpack.Stats>((resolve, reject) => compiler.run((error, result) => {
      if (error) reject(error)
      else if (!result) reject(new Error('Webpack returned no build result'))
      else resolve(result)
    }))
    expect(stats.toJson({ all: false, errors: true, warnings: true })).toMatchObject({ errors: [], warnings: [] })
  } finally {
    await new Promise<void>((resolve, reject) => compiler.close((error) => error ? reject(error) : resolve()))
  }
  const { LogViewer } = require(join(directory, 'bundle', 'viewer.cjs'))
  await assertWebResources(new LogViewer({ dir: directory, port: 0 }))
}))
