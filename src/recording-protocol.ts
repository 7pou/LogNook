import { isLogCursor } from './log-protocol'

export type RecordingState = 'open' | 'pause'

export interface RecordingSnapshot {
  sessionId: string
  revision: number
  state: RecordingState
}

export interface RecordingControls {
  getSnapshot(): RecordingSnapshot
  pause(): void
  resume(): void
  subscribe(listener: (snapshot: RecordingSnapshot) => void): () => void
}

export function isRecordingSnapshot(value: unknown): value is RecordingSnapshot {
  return isLogCursor(value) && 'state' in value && (value.state === 'open' || value.state === 'pause')
}

export function decodeRecordingEvent(data: string): RecordingSnapshot {
  const value: unknown = JSON.parse(data)
  if (!isRecordingSnapshot(value)) throw new Error('录制状态格式无效')
  return { sessionId: value.sessionId, revision: value.revision, state: value.state }
}

export function encodeRecordingEvent(snapshot: RecordingSnapshot): string {
  return `event: recording\ndata: ${JSON.stringify(snapshot)}\n\n`
}
