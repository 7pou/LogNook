import { expect, test, vi } from 'vitest'
import { clearLogs, fetchLogs } from './api'

const logs = { filename: 'app.log', query: '', total: 0, matched: 0, entries: [], cursor: { sessionId: 'session', revision: 0 }, clearToken: '0123456789abcdef0123456789abcdef' }

test('clear uses a fixed POST path, token and signal without a body', async () => {
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ cursor: logs.cursor })))
  vi.stubGlobal('fetch', request)
  const signal = new AbortController().signal
  expect(await clearLogs(logs.clearToken, signal)).toEqual({ cursor: logs.cursor })
  expect(request).toHaveBeenCalledWith('/api/logs/clear', { method: 'POST', cache: 'no-store', signal, headers: { 'X-Log-Viewer-Token': logs.clearToken } })
})

test.each([403, 500])('clear reports HTTP %s failure', async (status) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: '清空失败' }), { status })))
  await expect(clearLogs(logs.clearToken, new AbortController().signal)).rejects.toThrow('清空失败')
})

test.each(['not JSON', '{}', '{"cursor":{"sessionId":"s","revision":-1}}'])('clear rejects invalid response %s', async (body) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
  await expect(clearLogs(logs.clearToken, new AbortController().signal)).rejects.toThrow()
})

test('requests the same-origin API with encoded query, no caching and cancellation', async () => {
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(logs)))
  vi.stubGlobal('fetch', request)
  const signal = new AbortController().signal
  expect(await fetchLogs('中文 & Alice', signal)).toEqual(logs)
  expect(request).toHaveBeenCalledWith('/api/logs?q=%E4%B8%AD%E6%96%87+%26+Alice', { cache: 'no-store', signal })
})

test('reports the API error message', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: '无法读取日志' }), { status: 500 })))
  await expect(fetchLogs('', new AbortController().signal)).rejects.toThrow('无法读取日志')
})

test('network failures remain errors', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  await expect(fetchLogs('', new AbortController().signal)).rejects.toThrow('offline')
})

test.each(['not JSON', 'null', '{}', '{"filename":"app.log","entries":[]}'])('rejects invalid successful response %s', async (body) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
  await expect(fetchLogs('', new AbortController().signal)).rejects.toThrow()
})

test('non-JSON HTTP errors report their status', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad gateway', { status: 502 })))
  await expect(fetchLogs('', new AbortController().signal)).rejects.toThrow('502')
})
