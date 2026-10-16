import { expect, test } from 'vitest'
import { matchesLogEntry, normalizeQuery } from '../src/log-matcher'

test('matches titles, serialized messages and raw text with trimmed case-insensitive queries', () => {
  const entry = { kind: 'structured' as const, timestamp: '2026-10-16T00:00:00Z', title: '用户', message: { name: 'Alice' } }
  expect(normalizeQuery(' ALICE ')).toBe('ALICE')
  expect(matchesLogEntry(entry, ' ALICE ')).toBe(true)
  expect(matchesLogEntry(entry, '用户')).toBe(true)
  expect(matchesLogEntry({ kind: 'raw', raw: '{partial' }, 'PARTIAL')).toBe(true)
  expect(matchesLogEntry(entry, 'missing')).toBe(false)
  expect(matchesLogEntry(entry, '')).toBe(true)
})
