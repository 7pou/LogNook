import { expect, test, vi } from 'vitest'
import { fetchRecording, updateRecording } from './api'

const snapshot = { sessionId: 'session', revision: 1, state: 'pause' }

test('reads authoritative recording state without caching', async () => {
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(snapshot)))
  vi.stubGlobal('fetch', request)
  const signal = new AbortController().signal
  expect(await fetchRecording(signal)).toEqual(snapshot)
  expect(request).toHaveBeenCalledWith('/api/recording', { cache: 'no-store', signal })
})

test.each(['pause', 'resume'] as const)('posts %s with token and cancellation but no query/body', async (action) => {
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(snapshot)))
  vi.stubGlobal('fetch', request)
  const signal = new AbortController().signal
  expect(await updateRecording(action, 'token', signal)).toEqual(snapshot)
  expect(request).toHaveBeenCalledWith(`/api/recording/${action}`, { method: 'POST', cache: 'no-store', signal, headers: { 'X-Log-Viewer-Token': 'token' } })
})

test.each(['not JSON', '{}', '{"sessionId":"s","revision":0,"state":"closed"}'])('rejects malformed status %s', async (body) => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(body)))
  const signal = new AbortController().signal
  await expect(fetchRecording(signal)).rejects.toThrow()
  await expect(updateRecording('pause', 'token', signal)).rejects.toThrow()
})

test('reports protected API errors and rejects unknown actions before issuing requests', async () => {
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: '令牌无效' }), { status: 403 }))
  vi.stubGlobal('fetch', request)
  await expect(updateRecording('pause', 'bad', new AbortController().signal)).rejects.toThrow('令牌无效')
  request.mockClear()
  await expect(updateRecording('evil' as 'pause', 'token', new AbortController().signal)).rejects.toThrow()
  expect(request).not.toHaveBeenCalled()
})
