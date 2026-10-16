import { resolveOptions } from './config'
import { Logger, LogStoreClosedError } from './logger'
import type { RecordingSnapshot, RecordingState } from './recording-protocol'
import type { LogInput, LogViewerOptions, ServerInfo } from './types'
import { HtmlServer } from './viewer-server'

export class LogViewer {
  private readonly logger: Logger
  private readonly htmlServer: HtmlServer
  private state: 'open' | 'pause' | 'closing' | 'closed' = 'open'
  private recordingRevision = 0
  private readonly recordingListeners = new Set<(snapshot: RecordingSnapshot) => void>()
  private closing?: Promise<void>
  private filter?: (input: string | LogInput) => boolean 

  constructor(options?: LogViewerOptions) {
    const resolved = resolveOptions(options)
    this.logger = new Logger(resolved.logPath)
    this.htmlServer = new HtmlServer(resolved, undefined, this.logger, {
      getSnapshot: () => this.recordingSnapshot(),
      pause: () => this.pause(),
      resume: () => this.resume(),
      subscribe: (listener) => {
        const snapshot = this.recordingSnapshot()
        this.recordingListeners.add(listener)
        try { listener(snapshot) } catch { this.recordingListeners.delete(listener) }
        return () => { this.recordingListeners.delete(listener) }
      },
    })
    this.filter = options?.filter
  }

  log(input: string | LogInput): Promise<void> {
    if (this.state === 'pause') return Promise.resolve()
    if (this.filter && this.filter(input) === false) return Promise.resolve()
    if (this.state !== 'open') return Promise.reject(new Error('LogViewer is closed'))
    return this.logger.log(input)
  }

  server(): Promise<ServerInfo> {
    if (this.state === 'closing' || this.state === 'closed') return Promise.reject(new Error('LogViewer is closed'))
    return this.htmlServer.run()
  }

  pause(): void {
    this.setRecording('pause')
  }

  resume(): void {
    this.setRecording('open')
  }

  private recordingSnapshot(): RecordingSnapshot {
    if (this.state === 'closing' || this.state === 'closed') throw new LogStoreClosedError()
    return { sessionId: this.logger.sessionId, revision: this.recordingRevision, state: this.state }
  }

  private setRecording(state: RecordingState): void {
    if (this.state === 'closing' || this.state === 'closed') throw new Error('LogViewer is closed')
    if (this.state === state) return
    this.state = state
    this.recordingRevision += 1
    const snapshot = this.recordingSnapshot()
    for (const listener of this.recordingListeners) {
      try { listener(snapshot) } catch {}
    }
  }

  close(): Promise<void> {
    if (this.closing) return this.closing
    this.state = 'closing'
    this.logger.stopAccepting()
    this.closing = (async () => {
      const results = await Promise.allSettled([this.logger.flush(), this.htmlServer.close()])
      this.state = 'closed'
      this.recordingListeners.clear()
      for (const result of results) {
        if (result.status === 'rejected') throw result.reason
      }
    })()
    return this.closing
  }
}
