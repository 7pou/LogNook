import type { LogEntry } from './log-types'

export function normalizeQuery(query: string): string { return query.trim() }

export function matchesLogEntry(entry: LogEntry, query: string): boolean {
  const text = entry.kind === 'raw' ? entry.raw : `${entry.title ?? ''} ${JSON.stringify(entry.message)}`
  return text.toLowerCase().includes(normalizeQuery(query).toLowerCase())
}
