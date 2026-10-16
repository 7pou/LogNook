import type { LogsSnapshot } from '../../../src/log-types'

export const logs: LogsSnapshot = {
  cursor: { sessionId: 'session', revision: 0 }, clearToken: '0123456789abcdef0123456789abcdef',
  filename: 'custom.log', query: '', total: 1, matched: 1,
  entries: [{ kind: 'structured', timestamp: '2026-10-15T02:00:00Z', title: '用户信息', message: { name: 'Alice' } }],
}

export function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: Error) => void
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
