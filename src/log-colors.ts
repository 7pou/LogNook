import type { LogEntry } from './log-types'

export function getEntryColor(entry: LogEntry): string | undefined {
  return entry.kind === 'structured' ? entry.color?.trim() || undefined : undefined
}

export function getLogColors(entries: readonly LogEntry[]): string[] {
  const colors = new Set<string>()
  for (const entry of entries) {
    const color = getEntryColor(entry)
    if (color) colors.add(color)
  }
  return [...colors]
}
