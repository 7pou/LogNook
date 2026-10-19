import type { LogChangeEvent, LogCursor, LogsSnapshot } from '../../src/log-types'
import { matchesLogEntry } from '../../src/log-matcher'
import { getEntryColor, getLogColors } from '../../src/log-colors'

export interface LogViewState { data: LogsSnapshot | null; batch: number }
export interface ApplyResult { state: LogViewState; needsResync: boolean }

export function applyChange(previous: LogViewState, event: LogChangeEvent): ApplyResult {
  const data = previous.data
  if (!data || data.cursor.sessionId !== event.cursor.sessionId) return { state: previous, needsResync: true }
  if (event.cursor.revision <= data.cursor.revision) return { state: previous, needsResync: false }
  const gap = event.cursor.revision !== data.cursor.revision + 1
  if (event.type === 'reset') {
    return { state: { batch: previous.batch + 1, data: { ...data, cursor: event.cursor, total: 0, matched: 0, entries: [], colors: [] } }, needsResync: gap }
  }
  if (event.type === 'resync' || gap) return { state: previous, needsResync: true }
  const matched = matchesLogEntry(event.entry, data.query)
  const color = getEntryColor(event.entry)
  const colors = data.colors ?? getLogColors(data.entries)
  const nextColors = color && !colors.includes(color) ? [...colors, color] : colors
  return {
    state: { batch: previous.batch, data: { ...data, cursor: event.cursor, total: data.total + 1, matched: data.matched + Number(matched), entries: matched ? [...data.entries, event.entry] : data.entries, colors: nextColors } },
    needsResync: false,
  }
}

export function mergeSnapshot(previous: LogViewState, snapshot: LogsSnapshot, events: readonly LogChangeEvent[], minimumCursor?: LogCursor): ApplyResult {
  if (minimumCursor && snapshot.cursor.sessionId !== minimumCursor.sessionId) return { state: previous, needsResync: true }
  let state: LogViewState = { data: snapshot, batch: previous.batch + 1 }
  const pending = events.filter((event) => event.cursor.sessionId === snapshot.cursor.sessionId && event.cursor.revision > snapshot.cursor.revision).slice().sort((first, second) => first.cursor.revision - second.cursor.revision)
  for (const event of pending) {
    const result = applyChange(state, event)
    if (result.needsResync) return { state: previous, needsResync: true }
    state = result.state
  }
  if (minimumCursor && state.data!.cursor.revision < minimumCursor.revision) return { state: previous, needsResync: true }
  return { state, needsResync: false }
}
