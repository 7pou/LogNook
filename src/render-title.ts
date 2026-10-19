import { types } from 'node:util'
import type { LogEntry } from './log-types'
import type { LogInput, LogViewerOptions } from './types'

export function renderEntryTitle(entry: LogEntry, renderTitle?: LogViewerOptions['renderTitle']): LogEntry {
  if (!renderTitle) return entry
  try {
    const input: LogInput = entry.kind === 'raw' ? { message: entry.raw }
      : { title: entry.title, color: entry.color, message: structuredClone(entry.message) }
    const html: unknown = renderTitle(input)
    if (typeof html === 'string') return { ...entry, titleHtml: html }
    if (types.isPromise(html)) void html.catch(() => undefined)
  } catch {}
  return entry
}
