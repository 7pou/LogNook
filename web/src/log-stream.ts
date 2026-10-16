import { decodeLogEvent } from '../../src/log-protocol'
import type { LogStreamEvent } from '../../src/log-types'
import { decodeRecordingEvent, type RecordingSnapshot } from '../../src/recording-protocol'

export function openLogStream(handlers: {
  onEvent: (event: LogStreamEvent) => void
  onRecording?: (snapshot: RecordingSnapshot) => void
  onRecordingError?: (error: Error) => void
  onDisconnect: () => void
  onProtocolError: (error: Error) => void
}): () => void {
  const source = new EventSource('/api/events')
  let disposed = false
  const receive = (message: Event) => {
    if (disposed) return
    try {
      const payload = message as MessageEvent<string>
      const event = decodeLogEvent(message.type, payload.data)
      if (payload.lastEventId && payload.lastEventId !== `${event.cursor.sessionId}:${event.cursor.revision}`) throw new Error('日志事件 ID 与游标不一致')
      handlers.onEvent(event)
    } catch (error) { handlers.onProtocolError(error instanceof Error ? error : new Error('日志事件格式无效')) }
  }
  const disconnect = () => { if (!disposed) handlers.onDisconnect() }
  const recording = (message: Event) => {
    if (disposed) return
    try { handlers.onRecording?.(decodeRecordingEvent((message as MessageEvent<string>).data)) }
    catch (error) { (handlers.onRecordingError ?? handlers.onProtocolError)(error instanceof Error ? error : new Error('录制状态格式无效')) }
  }
  for (const type of ['ready', 'append', 'reset', 'resync']) source.addEventListener(type, receive)
  source.addEventListener('error', disconnect)
  source.addEventListener('recording', recording)
  return () => {
    if (disposed) return
    disposed = true
    for (const type of ['ready', 'append', 'reset', 'resync']) source.removeEventListener(type, receive)
    source.removeEventListener('error', disconnect)
    source.removeEventListener('recording', recording)
    source.close()
  }
}
