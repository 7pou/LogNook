import { readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { expect, test, vi } from 'vitest'
import { LogViewer } from '../src/log-viewer'
import type { LogsSnapshot } from '../src/log-types'
import type { LogInput, LogViewerOptions } from '../src/types'
import { createWebFixture, openSse, withTempDir } from './helpers'
import { resolveOptions } from '../src/config'
import { HtmlServer } from '../src/viewer-server'

test('isolates cross-realm rejected Promises without terminating the Node process', async () => {
  const rendererUrl = new URL('../src/render-title.ts', import.meta.url).href
  const script = `
    import { renderEntryTitle } from ${JSON.stringify(rendererUrl)}
    import { runInNewContext } from 'node:vm'
    const entry = { kind: 'raw', raw: 'message' }
    const callback = runInNewContext('() => Promise.reject(new Error("renderer failed"))')
    const result = renderEntryTitle(entry, callback)
    if (result !== entry) throw new Error('Expected plain-title fallback')
    setImmediate(() => console.log('fallback'))
  `
  await expect(promisify(execFile)(process.execPath, ['--input-type=module', '-e', script])).resolves.toMatchObject({ stdout: 'fallback\n', stderr: '' })
})

test('renders historical titles on the web without changing the file or search semantics', () => withTempDir(async (directory) => {
  const renderTitle = vi.fn((input: LogInput) => `<div><strong>${input.title}</strong></div>`)
  const options = { dir: directory, port: 0, renderTitle }
  const viewer = new LogViewer(options)
  try {
    await viewer.log({ title: 'Original', color: 'red', message: { name: 'Alice' } })
    const logPath = join(directory, 'app.log')
    const before = await readFile(logPath, 'utf8')
    expect(renderTitle).not.toHaveBeenCalled()
    const { url } = await viewer.server()
    const snapshot = await (await fetch(new URL('/api/logs?q=Alice', url))).json() as LogsSnapshot
    expect(snapshot).toMatchObject({ matched: 1, entries: [{ title: 'Original', color: 'red', message: { name: 'Alice' }, titleHtml: '<div><strong>Original</strong></div>' }] })
    expect(renderTitle).toHaveBeenCalledWith({ title: 'Original', color: 'red', message: { name: 'Alice' } })
    expect(await readFile(logPath, 'utf8')).toBe(before)
    expect(before).not.toContain('titleHtml')
    expect(await (await fetch(new URL('/api/logs?q=strong', url))).json()).toMatchObject({ matched: 0 })
  } finally { await viewer.close() }
}))

test('applies the current renderer to existing files, plain strings and raw records', () => withTempDir(async (directory) => {
  const logPath = join(directory, 'app.log')
  const content = '{"timestamp":"2026-10-15T02:00:00Z","message":"plain"}\nraw line\n'
  await writeFile(logPath, content)
  let prefix = 'first'
  const renderTitle = vi.fn((input: LogInput) => `<b>${prefix}:${input.message}</b>`)
  const options = { dir: directory, port: 0, renderTitle }
  const viewer = new LogViewer(options)
  try {
    const { url } = await viewer.server()
    expect(await (await fetch(new URL('/api/logs', url))).json()).toMatchObject({ entries: [{ titleHtml: '<b>first:plain</b>' }, { kind: 'raw', raw: 'raw line', titleHtml: '<b>first:raw line</b>' }] })
    expect(renderTitle).toHaveBeenCalledWith({ message: 'plain' })
    expect(renderTitle).toHaveBeenCalledWith({ message: 'raw line' })
    prefix = 'next'
    expect(await (await fetch(new URL('/api/logs', url))).json()).toMatchObject({ entries: [{ titleHtml: '<b>next:plain</b>' }, { titleHtml: '<b>next:raw line</b>' }] })
    expect(await readFile(logPath, 'utf8')).toBe(content)
  } finally { await viewer.close() }
}))

test.each([
  { name: 'string', input: 'live message', expectedInput: { message: 'live message' } },
  { name: 'message-only object', input: { message: 'live message' }, expectedInput: { message: 'live message' } },
  { name: 'titled colored object', input: { title: 'Original', color: 'red', message: 'live message' }, expectedInput: { title: 'Original', color: 'red', message: 'live message' } },
])('renders live $name titles with LogInput without changing the persisted entry', ({ input, expectedInput }) => withTempDir(async (directory) => {
  const renderTitle = vi.fn((entry: LogInput) => `<i>${entry.message}</i>`)
  const options = { dir: directory, port: 0, renderTitle }
  const viewer = new LogViewer(options)
  const stream = await openSse((await viewer.server()).url)
  try {
    await stream.next()
    await viewer.log(input)
    expect(await stream.next()).toMatchObject({ type: 'append', entry: { message: 'live message', titleHtml: '<i>live message</i>' } })
    expect(renderTitle).toHaveBeenCalledWith(expectedInput)
    expect(JSON.parse((await readFile(join(directory, 'app.log'), 'utf8')).trim())).not.toHaveProperty('titleHtml')
  } finally { stream.close(); await viewer.close() }
}))

test.each(['throw', 'number', 'promise', 'rejected promise'])('falls back to plain titles when the renderer returns %s', (mode) => withTempDir(async (directory) => {
  const renderTitle = (() => {
    if (mode === 'throw') throw new Error('renderer failed')
    if (mode === 'rejected promise') return Promise.reject(new Error('async renderer failed'))
    return mode === 'number' ? 123 : Promise.resolve('<b>async</b>')
  }) as unknown as NonNullable<LogViewerOptions['renderTitle']>
  const viewer = new LogViewer({ dir: directory, port: 0, renderTitle })
  const stream = await openSse((await viewer.server()).url)
  try {
    await stream.next()
    await viewer.log({ title: 'Original', message: 'message' })
    const event = await stream.next()
    expect(event).toMatchObject({ type: 'append', entry: { title: 'Original' } })
    if (event.type === 'append') expect(event.entry).not.toHaveProperty('titleHtml')
    const snapshot = await (await fetch(new URL('/api/logs', (await viewer.server()).url))).json() as LogsSnapshot
    expect(snapshot.entries[0]).not.toHaveProperty('titleHtml')
  } finally { stream.close(); await viewer.close() }
}))

test('isolates renderer mutations from snapshot and live message data', () => withTempDir(async (directory) => {
  const options = { dir: directory, port: 0, renderTitle: (input: LogInput) => {
    input.title = 'changed'
    input.color = 'blue'
    ;(input.message as { name: string }).name = 'changed'
    return '<b>custom</b>'
  } }
  const viewer = new LogViewer(options)
  const stream = await openSse((await viewer.server()).url)
  try {
    await stream.next()
    await viewer.log({ title: 'Original', color: 'red', message: { name: 'Alice' } })
    expect(await stream.next()).toMatchObject({ entry: { title: 'Original', color: 'red', message: { name: 'Alice' }, titleHtml: '<b>custom</b>' } })
    expect(await (await fetch(new URL('/api/logs', (await viewer.server()).url))).json()).toMatchObject({ entries: [{ title: 'Original', color: 'red', message: { name: 'Alice' }, titleHtml: '<b>custom</b>' }] })
  } finally { stream.close(); await viewer.close() }
}))

test('ignores title HTML in the log file when no renderer is configured', () => withTempDir(async (directory) => {
  await writeFile(join(directory, 'app.log'), '{"timestamp":"2026-10-15T02:00:00Z","title":"Original","titleHtml":"<script>bad()</script>","disableSafeRendering":true,"message":"message"}\n')
  const viewer = new LogViewer({ dir: directory, port: 0 })
  try {
    const snapshot = await (await fetch(new URL('/api/logs', (await viewer.server()).url))).json() as LogsSnapshot
    expect(snapshot.entries[0]).toMatchObject({ title: 'Original' })
    expect(snapshot.entries[0]).not.toHaveProperty('titleHtml')
    expect(snapshot.disableSafeRendering).toBe(false)
  } finally { await viewer.close() }
}))

test.each([false, true])('exposes safe-rendering configuration %s without changing the file or weakening local request protection', (disableSafeRendering) => withTempDir(async (directory) => {
  const content = '{"timestamp":"2026-10-15T02:00:00Z","title":"Original","message":"message"}\n'
  await writeFile(join(directory, 'app.log'), content)
  const options = { dir: directory, port: 0, disableSafeRendering, renderTitle: () => '<i style="color:red" onclick="bad()">Custom</i>' }
  const service = new HtmlServer(resolveOptions(options), await createWebFixture(directory))
  try {
    const { url } = await service.run()
    const page = await fetch(url)
    const policy = page.headers.get('content-security-policy')!
    expect(policy).toContain("frame-ancestors 'none'")
    expect(policy).toContain("base-uri 'none'")
    if (disableSafeRendering) {
      expect(policy).not.toContain('script-src')
      expect(policy).not.toContain('style-src')
      expect(policy).not.toContain('default-src')
    } else {
      expect(policy).toContain("script-src 'self'")
      expect(policy).toContain("style-src 'self'")
    }
    const snapshot = await (await fetch(new URL('/api/logs', url))).json() as LogsSnapshot
    expect(snapshot.disableSafeRendering).toBe(disableSafeRendering)
    expect(snapshot.entries[0]).toMatchObject({ titleHtml: '<i style="color:red" onclick="bad()">Custom</i>' })
    expect((await fetch(new URL('/api/logs', url), { headers: { Origin: 'http://evil.example' } })).status).toBe(403)
    expect(await readFile(join(directory, 'app.log'), 'utf8')).toBe(content)
  } finally { await service.close() }
}))

test('passes the public safe-rendering option to the Web snapshot', () => withTempDir(async (directory) => {
  const options = { dir: directory, port: 0, disableSafeRendering: true }
  const viewer = new LogViewer(options)
  try {
    const snapshot = await (await fetch(new URL('/api/logs', (await viewer.server()).url))).json() as LogsSnapshot
    expect(snapshot.disableSafeRendering).toBe(true)
  } finally { await viewer.close() }
}))
