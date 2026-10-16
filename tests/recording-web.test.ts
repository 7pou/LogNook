import { readFile } from 'node:fs/promises'
import { get } from 'node:http'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { LogViewer } from '../src'
import { resolveOptions } from '../src/config'
import { HtmlServer } from '../src/viewer-server'
import { openEventStream, withTempDir } from './helpers'

test('protected HTTP controls pause actual writes and resume without changing log cursors', () => withTempDir(async (directory) => {
  const viewer = new LogViewer({ dir: directory, port: 0 })
  try {
    const { url } = await viewer.server()
    await viewer.log('keep')
    const logs = await (await fetch(new URL('/api/logs', url))).json() as { clearToken: string; cursor: { sessionId: string; revision: number } }
    const state = await (await fetch(new URL('/api/recording', url))).json()
    expect(state).toEqual({ sessionId: logs.cursor.sessionId, revision: 0, state: 'open' })
    const headers = { 'X-Log-Viewer-Token': logs.clearToken }
    const paused = await fetch(new URL('/api/recording/pause', url), { method: 'POST', headers })
    expect(paused.status).toBe(200)
    expect(await paused.json()).toMatchObject({ revision: 1, state: 'pause' })
    await viewer.log('discard')
    expect(await (await fetch(new URL('/api/logs', url))).json()).toMatchObject({ total: 1, cursor: logs.cursor })
    expect(await (await fetch(new URL('/api/recording/pause', url), { method: 'POST', headers })).json()).toMatchObject({ revision: 1 })
    const resumed = await fetch(new URL('/api/recording/resume', url), { method: 'POST', headers })
    expect(await resumed.json()).toMatchObject({ revision: 2, state: 'open' })
    await viewer.log('new')
    expect(await (await fetch(new URL('/api/logs', url))).json()).toMatchObject({ total: 2, cursor: { revision: 2 } })
    expect(await readFile(join(directory, 'app.log'), 'utf8')).not.toContain('discard')
  } finally { await viewer.close() }
}))

test('SSE announces initial state and broadcasts code-side transitions to both clients', () => withTempDir(async (directory) => {
  const viewer = new LogViewer({ dir: directory, port: 0 })
  let first: Awaited<ReturnType<typeof openEventStream>> | undefined
  let second: Awaited<ReturnType<typeof openEventStream>> | undefined
  try {
    viewer.pause()
    const { url } = await viewer.server()
    first = await openEventStream(url)
    second = await openEventStream(url)
    for (const stream of [first, second]) {
      const ready = await stream.next()
      expect(ready.type).toBe('ready')
      const initial = await stream.next()
      expect(initial.type).toBe('recording')
      expect(JSON.parse(initial.data)).toMatchObject({ sessionId: JSON.parse(ready.data).cursor.sessionId, revision: 1, state: 'pause' })
    }
    viewer.pause()
    viewer.resume()
    for (const stream of [first, second]) {
      const event = await stream.next()
      expect(event.type).toBe('recording')
      expect(JSON.parse(event.data)).toMatchObject({ revision: 2, state: 'open' })
    }
    await viewer.log('actual append')
    expect(JSON.parse((await first.next()).data)).toMatchObject({ cursor: { revision: 1 }, entry: { message: 'actual append' } })
    expect(JSON.parse((await second.next()).data)).toMatchObject({ cursor: { revision: 1 }, entry: { message: 'actual append' } })
    first.close(); first = undefined
    viewer.pause()
    expect(JSON.parse((await second.next()).data)).toMatchObject({ revision: 3, state: 'pause' })
  } finally { first?.close(); second?.close(); await viewer.close() }
}))

test('recording routes reject unsafe methods, bodies, queries, tokens and origins', () => withTempDir(async (directory) => {
  const viewer = new LogViewer({ dir: directory, port: 0 })
  try {
    const { url, port } = await viewer.server()
    const logs = await (await fetch(new URL('/api/logs', url))).json() as { clearToken: string }
    const headers = { 'X-Log-Viewer-Token': logs.clearToken }
    expect((await fetch(new URL('/api/recording', url), { method: 'HEAD' })).status).toBe(200)
    expect((await fetch(new URL('/api/recording?state=pause', url))).status).toBe(400)
    expect((await fetch(new URL('/api/recording', url), { method: 'POST', headers })).status).toBe(405)
    for (const action of ['pause', 'resume']) {
      const endpoint = new URL(`/api/recording/${action}`, url)
      for (const method of ['GET', 'HEAD', 'OPTIONS']) expect((await fetch(endpoint, { method })).status).toBe(405)
      expect((await fetch(endpoint, { method: 'POST' })).status).toBe(403)
      expect((await fetch(endpoint, { method: 'POST', headers: { 'X-Log-Viewer-Token': 'bad' } })).status).toBe(403)
      expect((await fetch(endpoint, { method: 'POST', headers: { ...headers, Origin: 'http://evil.example' } })).status).toBe(403)
      expect((await fetch(endpoint, { method: 'POST', headers, body: 'x' })).status).toBe(400)
      expect((await fetch(new URL(`/api/recording/${action}?state=x`, url), { method: 'POST', headers })).status).toBe(400)
    }
    const forged = await new Promise<number | undefined>((resolve, reject) => {
      get({ hostname: '127.0.0.1', port, path: '/api/recording', headers: { Host: 'evil.example' } }, response => { response.resume(); response.once('end', () => resolve(response.statusCode)) }).once('error', reject)
    })
    expect(forged).toBe(403)
    expect(await (await fetch(new URL('/api/recording', url))).json()).toMatchObject({ state: 'open', revision: 0 })
  } finally { await viewer.close() }
}))

test('standalone HTTP server never fabricates recording state without the facade', () => withTempDir(async (directory) => {
  const server = new HtmlServer(resolveOptions({ dir: directory, port: 0 }))
  try {
    const { url } = await server.run()
    const response = await fetch(new URL('/api/recording', url))
    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(await response.json()).toEqual({ error: '录制控制不可用。' })
  } finally { await server.close() }
}))

test('HTTP controls broadcast to both existing streams without touching the log cursor', () => withTempDir(async (directory) => {
  const viewer = new LogViewer({ dir: directory, port: 0 })
  const streams: Awaited<ReturnType<typeof openEventStream>>[] = []
  try {
    await viewer.log('history')
    const { url } = await viewer.server()
    const logs = await (await fetch(new URL('/api/logs', url))).json() as { clearToken: string; cursor: unknown }
    for (let index = 0; index < 2; index += 1) {
      const stream = await openEventStream(url)
      streams.push(stream)
      expect((await stream.next()).type).toBe('ready')
      expect((await stream.next()).type).toBe('recording')
    }
    for (const [revision, action] of ['pause', 'resume'].entries()) {
      const result = await fetch(new URL(`/api/recording/${action}`, url), { method: 'POST', headers: { 'X-Log-Viewer-Token': logs.clearToken } })
      expect(result.status).toBe(200)
      const snapshot = await result.json()
      expect(snapshot).toMatchObject({ revision: revision + 1, state: action === 'pause' ? 'pause' : 'open' })
      for (const stream of streams) {
        const event = await stream.next()
        expect(event.type).toBe('recording')
        expect(JSON.parse(event.data)).toEqual(snapshot)
      }
      expect(await (await fetch(new URL('/api/logs', url))).json()).toMatchObject({ cursor: logs.cursor, total: 1 })
    }
  } finally { for (const stream of streams) stream.close(); await viewer.close() }
}))
