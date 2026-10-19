import type { LogEntry, LogsResponse } from './log-types'
import { matchesLogEntry, normalizeQuery } from './log-matcher'
import { getLogColors } from './log-colors'

function parseEntry(raw: string): LogEntry {
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const record = value as Record<string, unknown>
      if (typeof record.timestamp === 'string' && Number.isFinite(Date.parse(record.timestamp)) && Object.hasOwn(record, 'message') && (record.title === undefined || typeof record.title === 'string')
        && (record.color === undefined || typeof record.color === 'string')) {
        return { kind: 'structured', timestamp: record.timestamp, title: record.title, color: record.color, message: record.message }
      }
    }
  } catch {}
  return { kind: 'raw', raw }
}

export function parseLogs(content: string, query = ''): Omit<LogsResponse, 'filename'> {
  const entries = content.split(/\r?\n/).filter((line) => line.trim() !== '').map(parseEntry)
  const normalized = normalizeQuery(query)
  const matches = entries.filter((entry) => matchesLogEntry(entry, normalized))
  return { query: normalized, total: entries.length, matched: matches.length, entries: matches, colors: getLogColors(entries) }
}
