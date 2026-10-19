import type { LogCursor, LogEntry, LogsSnapshot, LogStreamEvent } from './log-types'

export const MAX_BUFFER_BYTES = 1024 * 1024
export const SSE_HEARTBEAT_MS = 15_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isLogCursor(value: unknown): value is LogCursor {
  return isRecord(value) && typeof value.sessionId === 'string' && value.sessionId.length > 0
    && !/[\r\n:]/.test(value.sessionId) && Number.isSafeInteger(value.revision) && Number(value.revision) >= 0
}

export function isLogEntry(value: unknown): value is LogEntry {
  if (!isRecord(value)) return false
  if (value.kind === 'raw') return typeof value.raw === 'string'
  return value.kind === 'structured' && typeof value.timestamp === 'string' && Number.isFinite(Date.parse(value.timestamp))
    && Object.hasOwn(value, 'message') && (value.title === undefined || typeof value.title === 'string')
    && (value.color === undefined || typeof value.color === 'string')
}

export function isLogsSnapshot(value: unknown): value is LogsSnapshot {
  return isRecord(value) && typeof value.filename === 'string' && typeof value.query === 'string'
    && Number.isSafeInteger(value.total) && Number(value.total) >= 0
    && Number.isSafeInteger(value.matched) && Number(value.matched) >= 0 && Number(value.matched) <= Number(value.total)
    && Array.isArray(value.entries) && value.entries.length === value.matched && value.entries.every(isLogEntry)
    && (value.colors === undefined || (Array.isArray(value.colors) && value.colors.every((color) => typeof color === 'string')))
    && isLogCursor(value.cursor) && typeof value.clearToken === 'string' && value.clearToken.length > 0
}

export function decodeLogEvent(type: string, data: string): LogStreamEvent {
  const value: unknown = JSON.parse(data)
  if (!isRecord(value) || !isLogCursor(value.cursor)) throw new Error('无效日志事件游标')
  if (type === 'append' && isLogEntry(value.entry)) return { type, cursor: value.cursor, entry: value.entry }
  if (type === 'ready' || type === 'reset' || type === 'resync') return { type, cursor: value.cursor }
  throw new Error('无效日志事件')
}

export function encodeLogEvent(event: LogStreamEvent): string {
  const { type, ...data } = event
  return `id: ${event.cursor.sessionId}:${event.cursor.revision}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`
}
