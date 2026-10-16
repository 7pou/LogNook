import type { ServerResponse } from 'node:http'
import { encodeLogEvent, MAX_BUFFER_BYTES, SSE_HEARTBEAT_MS } from './log-protocol'
import type { LogStreamEvent } from './log-types'
import { encodeRecordingEvent, type RecordingControls } from './recording-protocol'

export class SseConnections {
  private readonly clients = new Set<() => void>()
  private closed = false

  async connect(response: ServerResponse, subscribe: (listener: (event: LogStreamEvent) => void) => Promise<() => void>, recording?: RecordingControls): Promise<void> {
    if (this.closed) throw new Error('SSE connections are closed')
    let disposed = false
    let unsubscribe: (() => void) | undefined
    let unsubscribeRecording: (() => void) | undefined
    let recordingAttached = false
    let timer: ReturnType<typeof setInterval> | undefined
    const cleanup = () => {
      if (disposed) return
      disposed = true
      if (timer) clearInterval(timer)
      unsubscribe?.()
      unsubscribeRecording?.()
      response.off('close', cleanup)
      response.off('error', disconnect)
      this.clients.delete(disconnect)
    }
    const disconnect = () => { cleanup(); response.destroy() }
    const write = (frame: string) => {
      if (disposed) return
      if (response.writableLength + Buffer.byteLength(frame) > MAX_BUFFER_BYTES) { disconnect(); return }
      try { response.write(frame) } catch { disconnect() }
    }
    this.clients.add(disconnect)
    response.on('close', cleanup)
    response.on('error', disconnect)
    try {
      unsubscribe = await subscribe((event) => {
        if (disposed) return
        if (!response.headersSent) {
          response.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Accel-Buffering': 'no',
            'X-Content-Type-Options': 'nosniff',
          })
          response.flushHeaders()
          timer = setInterval(() => write(': ping\n\n'), SSE_HEARTBEAT_MS)
          timer.unref()
        }
        let frame = encodeLogEvent(event)
        if (Buffer.byteLength(frame) > MAX_BUFFER_BYTES) frame = encodeLogEvent({ type: 'resync', cursor: event.cursor })
        write(frame)
        if (!disposed && event.type === 'ready' && recording && !recordingAttached) {
          recordingAttached = true
          try {
            unsubscribeRecording = recording.subscribe((snapshot) => write(encodeRecordingEvent(snapshot)))
            if (disposed) unsubscribeRecording()
          } catch { disconnect() }
        }
      })
      if (disposed) unsubscribe()
    } catch (error) {
      cleanup()
      if (response.headersSent) response.destroy()
      throw error
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const disconnect of this.clients) disconnect()
  }
}
