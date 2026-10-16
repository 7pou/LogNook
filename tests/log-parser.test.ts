import { expect, test } from 'vitest'
import { parseLogs } from '../src/log-parser'

const record = (message: unknown, title?: string) => JSON.stringify({ timestamp: '2026-10-15T02:00:00Z', title, message })

test('returns structured and raw records in file order', () => {
  const content = [record({ name: 'Alice' }, 'User'), '{partial', '{"timestamp":"invalid","message":null}'].join('\r\n')
  const all = parseLogs(content)
  expect(all.total).toBe(3)
  expect(all.entries.map((entry) => entry.kind)).toEqual(['structured', 'raw', 'raw'])
  expect(parseLogs(content, ' ALICE ')).toMatchObject({ query: 'ALICE', total: 3, matched: 1 })
  expect(parseLogs(content, 'user').matched).toBe(1)
  expect(parseLogs(content, 'partial').entries).toEqual([{ kind: 'raw', raw: '{partial' }])
})

test.each([{ message: null }, { message: false }, { message: 123 }, { message: ['中文', 1] }, { message: '多行\n文本' }])('preserves message $message', ({ message }) => {
  expect(parseLogs(record(message)).entries[0]).toMatchObject({ kind: 'structured', message })
})

test.each(['{"timestamp":"2026-10-15T02:00:00Z"}', '{"timestamp":"2026-10-15T02:00:00Z","message":1,"title":3}', 'null', '[1]', '{partial'])('preserves invalid record %s', (raw) => {
  expect(parseLogs(raw).entries).toEqual([{ kind: 'raw', raw }])
})

test('ignores blank lines and returns empty/no-match counts', () => {
  expect(parseLogs('\r\n \n')).toEqual({ query: '', total: 0, matched: 0, entries: [] })
  expect(parseLogs(record('one') + '\n\n' + record('two'), 'missing')).toMatchObject({ total: 2, matched: 0, entries: [] })
})
