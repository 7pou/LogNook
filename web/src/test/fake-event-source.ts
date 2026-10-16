import type { LogStreamEvent } from '../../../src/log-types'
import type { RecordingSnapshot } from '../../../src/recording-protocol'

export class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = []
  closed = false
  constructor(readonly url: string) { super(); FakeEventSource.instances.push(this) }
  emit(event: LogStreamEvent) {
    const { type, ...data } = event
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data), lastEventId: `${event.cursor.sessionId}:${event.cursor.revision}` }))
  }
  disconnect() { this.dispatchEvent(new Event('error')) }
  emitRecording(snapshot: RecordingSnapshot, lastEventId = '') {
    this.dispatchEvent(new MessageEvent('recording', { data: JSON.stringify(snapshot), lastEventId }))
  }
  close() { this.closed = true }
}
