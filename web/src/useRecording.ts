import { useCallback, useEffect, useRef, useState } from 'react'
import type { LogsSnapshot } from '../../src/log-types'
import type { RecordingSnapshot } from '../../src/recording-protocol'
import { fetchRecording, updateRecording } from './api'

export function useRecording(recording: RecordingSnapshot | null, snapshot: LogsSnapshot | null, enabled: boolean, onUpdated: (snapshot: RecordingSnapshot) => void, streamError: string | null = null) {
  const [action, setAction] = useState<'pause' | 'resume' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef({ recording, snapshot, enabled, onUpdated, streamError })
  latest.current = { recording, snapshot, enabled, onUpdated, streamError }
  const pending = useRef(false)
  const identity = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const sessionId = snapshot?.cursor.sessionId

  useEffect(() => {
    setAction(null); setError(null)
    const request = new AbortController()
    const requestIdentity = identity.current
    const observedRevision = latest.current.recording?.revision ?? -1
    if (enabled && sessionId) {
      fetchRecording(request.signal).then((result) => {
        if (request.signal.aborted) return
        if (result.sessionId !== sessionId) throw new Error('录制响应来自其他日志实例，请重新同步。')
        latest.current.onUpdated(result)
      }).catch((cause: unknown) => {
        if (!request.signal.aborted && requestIdentity === identity.current && (latest.current.recording?.revision ?? -1) <= observedRevision) {
          setError(cause instanceof Error ? cause.message : '无法读取录制状态，请重新同步。')
        }
      })
    }
    return () => {
      request.abort(); identity.current += 1; controller.current?.abort(); pending.current = false
    }
  }, [sessionId, enabled])

  const toggle = useCallback(async () => {
    const { recording: current, snapshot: logs, enabled: available } = latest.current
    if (!available || latest.current.streamError || !current || !logs || current.sessionId !== logs.cursor.sessionId || pending.current) return
    pending.current = true
    const requestIdentity = ++identity.current
    const request = new AbortController()
    controller.current = request
    const next = current.state === 'open' ? 'pause' : 'resume'
    setAction(next); setError(null)
    const isCurrent = () => !request.signal.aborted && requestIdentity === identity.current && latest.current.enabled && latest.current.snapshot?.cursor.sessionId === current.sessionId
    try {
      const result = await updateRecording(next, logs.clearToken, request.signal)
      if (!isCurrent()) return
      if (result.sessionId !== current.sessionId) throw new Error('录制响应来自其他日志实例，请重新同步。')
      latest.current.onUpdated(result)
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : '无法控制录制，请重试。')
    } finally {
      if (isCurrent()) { pending.current = false; setAction(null) }
    }
  }, [])

  return { action, error: streamError ?? error, toggle, disabled: !enabled || streamError !== null || !recording || recording.sessionId !== sessionId || action !== null }
}
