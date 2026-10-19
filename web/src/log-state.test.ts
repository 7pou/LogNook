import { expect, test } from 'vitest'
import { applyChange, mergeSnapshot, type LogViewState } from './log-state'
import { logs } from './test/fixtures'

const previous: LogViewState = { data: logs, batch: 4 }
const cursor = (revision: number) => ({ sessionId: 'session', revision })
const entry = { kind: 'raw' as const, raw: 'Alice second' }

test('matching append preserves batch; nonmatch advances total and cursor only', () => {
  const first = applyChange({ ...previous, data: { ...logs, query: 'ALICE' } }, { type: 'append', cursor: cursor(1), entry })
  expect(first).toMatchObject({ needsResync: false, state: { batch: 4, data: { total: 2, matched: 2, cursor: cursor(1) } } })
  const next = applyChange(first.state, { type: 'append', cursor: cursor(2), entry: { kind: 'raw', raw: 'Bob' } })
  expect(next.state.data).toMatchObject({ total: 3, matched: 2, cursor: cursor(2) })
  expect(next.state.data?.entries).toBe(first.state.data?.entries)
  expect(applyChange(next.state, { type: 'append', cursor: cursor(2), entry }).state).toBe(next.state)
})

test('gap, resync and other sessions do not fabricate entries', () => {
  for (const event of [{ type: 'append' as const, cursor: cursor(2), entry }, { type: 'resync' as const, cursor: cursor(1) }, { type: 'append' as const, cursor: { sessionId: 'other', revision: 1 }, entry }]) {
    expect(applyChange(previous, event)).toEqual({ state: previous, needsResync: true })
  }
})

test('reset empties safely, preserves metadata, changes batch once and detects gaps', () => {
  const reset = { type: 'reset' as const, cursor: cursor(2) }
  const cleared = applyChange(previous, reset)
  expect(cleared).toMatchObject({ needsResync: true, state: { batch: 5, data: { filename: 'custom.log', clearToken: logs.clearToken, query: '', total: 0, matched: 0, entries: [], cursor: cursor(2) } } })
  expect(applyChange(cleared.state, reset)).toEqual({ state: cleared.state, needsResync: false })
  expect(applyChange(cleared.state, { ...reset, cursor: cursor(1) }).state).toBe(cleared.state)
})

test('merges buffered clear and append before committing old snapshot; already included events are ignored', () => {
  const merged = mergeSnapshot(previous, logs, [
    { type: 'append', cursor: cursor(2), entry }, { type: 'reset', cursor: cursor(1) }, { type: 'append', cursor: cursor(2), entry },
  ], cursor(1))
  expect(merged).toMatchObject({ needsResync: false, state: { data: { total: 1, matched: 1, entries: [entry], cursor: cursor(2) } } })
  expect(mergeSnapshot(previous, { ...logs, cursor: cursor(2) }, [{ type: 'append', cursor: cursor(1), entry }]).state.data?.total).toBe(1)
})

test('missing reset or a mismatched session cannot resurrect a pre-clear snapshot', () => {
  expect(mergeSnapshot(previous, logs, [], cursor(1))).toEqual({ state: previous, needsResync: true })
  expect(mergeSnapshot(previous, logs, [], { sessionId: 'new', revision: 0 })).toEqual({ state: previous, needsResync: true })
})

test('discovers colors from nonmatching live entries and removes inventory on reset', () => {
  const initial = { ...previous, data: { ...logs, query: 'Alice', colors: ['red'] } }
  const added = applyChange(initial, {
    type: 'append', cursor: cursor(1),
    entry: { kind: 'structured', timestamp: '2026-10-15T02:00:00Z', color: ' blue ', message: 'Bob' },
  })
  expect(added.state.data).toMatchObject({ total: 2, matched: 1, colors: ['red', 'blue'] })
  expect(added.state.data?.entries).toBe(initial.data.entries)
  const repeated = applyChange(added.state, {
    type: 'append', cursor: cursor(2),
    entry: { kind: 'structured', timestamp: '2026-10-15T02:00:00Z', color: 'blue', message: 'Alice' },
  })
  expect(repeated.state.data?.colors).toEqual(['red', 'blue'])
  const cleared = applyChange(repeated.state, { type: 'reset', cursor: cursor(3) })
  expect(cleared.state.data).toMatchObject({ colors: [], entries: [], total: 0 })
})
