import { useCallback, useEffect, useRef, useState } from 'react'
import type { LogChangeEvent, LogCursor, LogsSnapshot } from '../../src/log-types'
import { encodeLogEvent, MAX_BUFFER_BYTES } from '../../src/log-protocol'
import { normalizeQuery } from '../../src/log-matcher'
import { fetchLogs } from './api'
import { applyChange, mergeSnapshot } from './log-state'
import { openLogStream } from './log-stream'
import type { RecordingSnapshot } from '../../src/recording-protocol'

export type ConnectionStatus = 'connecting' | 'syncing' | 'live' | 'reconnecting' | 'error'
interface LogsState {
  data: LogsSnapshot | null
  loading: boolean
  error: string | null
  batch: number
  connection: ConnectionStatus
}

export function useLogs(query: string, refreshKey: number) {
  const latestQuery = useRef(normalizeQuery(query))
  latestQuery.current = normalizeQuery(query)
  const initial: LogsState = { data: null, loading: true, error: null, batch: 0, connection: 'connecting' }
  const [state, setState] = useState<LogsState>(initial)
  const [recording, setRecording] = useState<RecordingSnapshot | null>(null)
  const [recordingError, setRecordingError] = useState<string | null>(null)
  const currentRecording = useRef<RecordingSnapshot | null>(null)
  const current = useRef(state)
  const actions = useRef<{ sync: () => void; clear: (cursor: LogCursor) => void; recording: (snapshot: RecordingSnapshot) => void } | null>(null)
  const applyClear = useCallback((cursor: LogCursor) => actions.current?.clear(cursor), [])
  const applyRecording = useCallback((snapshot: RecordingSnapshot) => actions.current?.recording(snapshot), [])

  useEffect(() => {
    let disposed = false
    let connectionIdentity = 0
    let requestIdentity = 0
    let closeStream: (() => void) | undefined
    let controller: AbortController | undefined
    let readyCursor: LogCursor | undefined
    let minimumCursor: LogCursor | undefined
    let buffering = false
    let buffer: LogChangeEvent[] = []
    let bufferBytes = 0

    const commit = (next: LogsState) => { if (!disposed) { current.current = next; setState(next) } }
    const abortSnapshot = () => { controller?.abort(); requestIdentity += 1; buffer = []; bufferBytes = 0; buffering = false }
    const closeConnection = () => { connectionIdentity += 1; closeStream?.(); closeStream = undefined; readyCursor = undefined }
    const observeMinimum = (cursor: LogCursor) => {
      if (!minimumCursor || minimumCursor.sessionId !== cursor.sessionId || cursor.revision > minimumCursor.revision) minimumCursor = cursor
    }

    function receiveRecording(snapshot: RecordingSnapshot) {
      if (disposed || !readyCursor || readyCursor.sessionId !== snapshot.sessionId) return
      const previous = currentRecording.current
      if (previous?.sessionId === snapshot.sessionId && previous.revision > snapshot.revision) return
      setRecordingError(null)
      if (previous?.sessionId === snapshot.sessionId && previous.revision === snapshot.revision) return
      currentRecording.current = snapshot
      setRecording(snapshot)
    }

    function synchronize() {
      if (disposed || !readyCursor) return
      abortSnapshot()
      buffering = true
      const identity = ++requestIdentity
      const generation = connectionIdentity
      const requestedQuery = latestQuery.current
      const request = new AbortController()
      controller = request
      commit({ ...current.current, loading: true, error: null, connection: 'syncing' })
      fetchLogs(requestedQuery, request.signal).then((snapshot) => {
        if (disposed || request.signal.aborted || identity !== requestIdentity || generation !== connectionIdentity) return
        if (snapshot.query !== requestedQuery) throw new Error('日志快照与当前查询不一致，请重新同步。')
        const merged = mergeSnapshot(current.current, snapshot, buffer, minimumCursor)
        if (merged.needsResync) { restart(); return }
        buffer = []; bufferBytes = 0; buffering = false
        commit({ ...merged.state, loading: false, error: null, connection: 'live' })
      }).catch((error: unknown) => {
        if (disposed || request.signal.aborted || identity !== requestIdentity || generation !== connectionIdentity) return
        abortSnapshot(); closeConnection()
        commit({ ...current.current, loading: false, connection: 'error', error: error instanceof Error ? error.message : '无法读取日志，请重新同步。' })
      })
    }

    function receiveChange(event: LogChangeEvent) {
      if (disposed) return
      if (readyCursor && event.cursor.sessionId !== readyCursor.sessionId) { restart(); return }
      const displayed = current.current.data?.cursor
      if (!buffering && displayed?.sessionId === event.cursor.sessionId && displayed.revision >= event.cursor.revision) return
      if (event.type === 'reset') {
        observeMinimum(event.cursor)
        const cleared = applyChange(current.current, event)
        if (cleared.state !== current.current) commit({ ...current.current, ...cleared.state })
        if (cleared.needsResync && !buffering && current.current.connection === 'live') { restart(); return }
      }
      if (event.type === 'resync') { restart(); return }
      if (buffering) {
        const bytes = new TextEncoder().encode(encodeLogEvent(event)).byteLength
        if (bufferBytes + bytes > MAX_BUFFER_BYTES) { restart(); return }
        buffer.push(event); bufferBytes += bytes
        return
      }
      if (current.current.connection !== 'live') return
      const applied = applyChange(current.current, event)
      if (applied.state !== current.current) commit({ ...current.current, ...applied.state })
      if (applied.needsResync) restart()
    }

    function restart() {
      if (disposed) return
      abortSnapshot(); closeConnection()
      commit({ ...current.current, loading: true, error: null, connection: 'connecting' })
      const generation = connectionIdentity
      try {
        closeStream = openLogStream({
          onEvent: (event) => {
            if (disposed || generation !== connectionIdentity) return
            if (event.type === 'ready') {
              readyCursor = event.cursor
              if (currentRecording.current?.sessionId !== event.cursor.sessionId) {
                currentRecording.current = null
                setRecording(null)
                setRecordingError(null)
              }
              observeMinimum(event.cursor); synchronize()
            }
            else receiveChange(event)
          },
          onRecording: (snapshot) => { if (!disposed && generation === connectionIdentity) receiveRecording(snapshot) },
          onRecordingError: (error) => { if (!disposed && generation === connectionIdentity) setRecordingError(`无法同步录制状态：${error.message}。请重新同步。`) },
          onDisconnect: () => {
            if (disposed || generation !== connectionIdentity) return
            abortSnapshot(); readyCursor = undefined
            commit({ ...current.current, loading: false, error: null, connection: 'reconnecting' })
          },
          onProtocolError: () => { if (!disposed && generation === connectionIdentity) restart() },
        })
      } catch (error) {
        closeConnection()
        commit({ ...current.current, loading: false, connection: 'error', error: error instanceof Error ? error.message : '无法建立实时连接。' })
      }
    }

    actions.current = {
      recording: receiveRecording,
      sync: () => {
        if (!readyCursor && current.current.connection === 'error') restart()
        else synchronize()
      },
      clear: (cursor) => {
        const active = readyCursor ?? current.current.data?.cursor
        if (!active || active.sessionId !== cursor.sessionId) return
        const displayed = current.current.data?.cursor
        if (displayed?.sessionId === cursor.sessionId && displayed.revision >= cursor.revision) return
        receiveChange({ type: 'reset', cursor })
      },
    }
    restart()
    return () => { disposed = true; abortSnapshot(); closeConnection(); actions.current = null }
  }, [refreshKey])

  useEffect(() => { actions.current?.sync() }, [query])
  return { ...state, recording, recordingError, applyClear, applyRecording }
}
