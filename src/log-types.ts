export type LogEntry =
  | { kind: 'structured'; timestamp: string; title?: string; color?: string; message: unknown }
  | { kind: 'raw'; raw: string }

export interface LogsResponse {
  filename: string
  query: string
  total: number
  matched: number
  entries: LogEntry[]
}

export interface LogsErrorResponse {
  error: string
}

export interface LogCursor { sessionId: string; revision: number }
export interface LogsSnapshot extends LogsResponse { cursor: LogCursor; clearToken: string }
export type LogSnapshotData = Omit<LogsSnapshot, 'filename' | 'clearToken'>
export interface ClearLogsResponse { cursor: LogCursor }
export type LogChangePayload = { type: 'append'; entry: LogEntry } | { type: 'reset' } | { type: 'resync' }
export type LogChangeEvent =
  | { type: 'append'; cursor: LogCursor; entry: LogEntry }
  | { type: 'reset'; cursor: LogCursor }
  | { type: 'resync'; cursor: LogCursor }
export type LogStreamEvent = LogChangeEvent | { type: 'ready'; cursor: LogCursor }
