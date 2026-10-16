import { useCallback, useEffect, useRef, useState } from 'react'
import type { LogCursor, LogsSnapshot } from '../../src/log-types'
import { clearLogs } from './api'

export function useClearLogs(snapshot: LogsSnapshot | null, canClear: boolean, onCleared: (cursor: LogCursor) => void) {
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef({ snapshot, canClear, onCleared })
  latest.current = { snapshot, canClear, onCleared }
  const pending = useRef(false)
  const identity = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const sessionId = snapshot?.cursor.sessionId

  useEffect(() => {
    setClearing(false); setError(null)
    return () => { identity.current += 1; controller.current?.abort(); pending.current = false }
  }, [sessionId])

  const clear = useCallback(async (): Promise<boolean> => {
    const { snapshot: current, canClear: enabled } = latest.current
    if (!current || !enabled || pending.current) return false
    pending.current = true
    const requestIdentity = ++identity.current
    const request = new AbortController()
    controller.current = request
    setClearing(true); setError(null)
    const isCurrent = () => !request.signal.aborted && requestIdentity === identity.current && latest.current.snapshot?.cursor.sessionId === current.cursor.sessionId
    try {
      const result = await clearLogs(current.clearToken, request.signal)
      if (!isCurrent()) return false
      if (result.cursor.sessionId !== current.cursor.sessionId) throw new Error('清空响应来自其他日志实例，请重新同步。')
      latest.current.onCleared(result.cursor)
      return true
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : '无法清空日志，请重试。')
      return false
    } finally {
      if (isCurrent()) { pending.current = false; setClearing(false) }
    }
  }, [])

  return { clearing, error, clear }
}
