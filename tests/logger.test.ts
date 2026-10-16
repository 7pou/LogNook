import { access, appendFile, open, readFile, truncate, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, expect, test, vi } from 'vitest'
import { Logger } from '../src/logger'
import type { LogInput } from '../src/types'
import type { LogStreamEvent } from '../src/log-types'
import { deferred, withTempDir } from './helpers'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, appendFile: vi.fn(actual.appendFile), truncate: vi.fn(actual.truncate), open: vi.fn(actual.open) }
})

beforeEach(() => vi.clearAllMocks())

test('writes ordered snapshots as JSON Lines', () => withTempDir(async (directory) => {
  const logPath = join(directory, 'nested', 'app.log')
  const logger = new Logger(logPath)
  const message = { id: 1 }
  const first = logger.log({ title: '用户', message })
  message.id = 2
  await Promise.all([first, logger.log('第二条\n下一行'), logger.log({ message: null })])
  const content = await readFile(logPath, 'utf8')
  expect(content.endsWith('\n')).toBe(true)
  const entries = content.trim().split('\n').map((line) => JSON.parse(line))
  expect(entries.map((entry) => entry.message)).toEqual([{ id: 1 }, '第二条\n下一行', null])
  expect(entries[0].title).toBe('用户')
  expect(entries[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/)
  expect(entries[1]).not.toHaveProperty('title')
}))

test.each([undefined, () => 1, Symbol('value'), NaN, Infinity, 1n, { toJSON: () => undefined }])('rejects unsupported message %s', (message) => withTempDir(async (directory) => {
  const logPath = join(directory, 'app.log')
  const logger = new Logger(logPath)
  await expect(logger.log({ message })).rejects.toThrow()
  await expect(access(logPath)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(logger.log('合法消息')).resolves.toBeUndefined()
}))

test.each([{}, null, [], { title: 1, message: 'text' }].map((input) => [input]))('rejects invalid input %s', (input) => withTempDir(async (directory) => {
  const logger = new Logger(join(directory, 'app.log'))
  await expect(logger.log(input as LogInput)).rejects.toThrow(TypeError)
}))

test.each([false, 123, null, ['文本', 1], { nested: { value: 1 } }].map((message) => [message]))('preserves JSON message %s', (message) => withTempDir(async (directory) => {
  const logPath = join(directory, 'app.log')
  const logger = new Logger(logPath)
  await logger.log({ title: '', message })
  expect(JSON.parse((await readFile(logPath, 'utf8')).trim())).toMatchObject({ title: '', message })
}))

test('rejects cyclic data and throwing getters without breaking the queue', () => withTempDir(async (directory) => {
  const logger = new Logger(join(directory, 'app.log'))
  const cyclic: { self?: unknown } = {}
  cyclic.self = cyclic
  await expect(logger.log({ message: cyclic })).rejects.toThrow()
  await expect(logger.log({ message: { get value() { throw new Error('getter failed') } } })).rejects.toThrow('getter failed')
  await expect(logger.log('恢复写入')).resolves.toBeUndefined()
}))

test('uses native JSON semantics for nested undefined', () => withTempDir(async (directory) => {
  const logPath = join(directory, 'app.log')
  await new Logger(logPath).log({ message: { omitted: undefined, items: [undefined] } })
  expect(JSON.parse((await readFile(logPath, 'utf8')).trim()).message).toEqual({ items: [null] })
}))

test('appends without overwriting existing content', () => withTempDir(async (directory) => {
  const logPath = join(directory, 'app.log')
  await writeFile(logPath, 'old log\n')
  await new Logger(logPath).log('new log')
  expect(await readFile(logPath, 'utf8')).toMatch(/^old log\n\{"timestamp"/)
}))

test('recovers after one append failure and flush waits for writes', () => withTempDir(async (directory) => {
  const logPath = join(directory, 'app.log')
  const logger = new Logger(logPath)
  vi.mocked(appendFile).mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }))
  await expect(logger.log('失败')).rejects.toThrow('denied')
  const writing = logger.log('恢复')
  await logger.flush()
  await writing
  expect(JSON.parse((await readFile(logPath, 'utf8')).trim()).message).toBe('恢复')
}))

test('serializes append, snapshot, clear and append with committed events', () => withTempDir(async (directory) => {
  const logPath = join(directory, 'app.log')
  const logger = new Logger(logPath)
  const events: LogStreamEvent[] = []
  const unsubscribe = await logger.subscribe((event) => events.push(event))
  const first = logger.log('before')
  const before = logger.readSnapshot()
  const clearing = logger.clear()
  const after = logger.log('after')
  await Promise.all([first, clearing, after])
  expect(await before).toMatchObject({ cursor: { revision: 1 }, entries: [{ message: 'before' }] })
  expect(await logger.readSnapshot()).toMatchObject({ cursor: { revision: 3 }, total: 1, entries: [{ message: 'after' }] })
  expect(events.map((event) => event.type)).toEqual(['ready', 'append', 'reset', 'append'])
  expect((await readFile(logPath, 'utf8')).trim().split('\n')).toHaveLength(1)
  unsubscribe()
}))

test('ready precedes a queued append and snapshot waits for a held write', () => withTempDir(async (directory) => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  const gate = deferred<void>()
  const logger = new Logger(join(directory, 'app.log'))
  const events: LogStreamEvent[] = []
  const subscribed = logger.subscribe((event) => events.push(event))
  vi.mocked(appendFile).mockImplementationOnce(async (...args) => { await gate.promise; await actual.appendFile(...args) })
  const writing = logger.log('held')
  let settled = false
  const reading = logger.readSnapshot().then((snapshot) => { settled = true; return snapshot })
  const unsubscribe = await subscribed
  expect(events.map((event) => event.type)).toEqual(['ready'])
  expect(settled).toBe(false)
  gate.resolve()
  await writing
  expect(await reading).toMatchObject({ cursor: { revision: 1 }, entries: [{ message: 'held' }] })
  unsubscribe()
}))

test('unterminated tail resyncs and a later terminated append is independent', () => withTempDir(async (directory) => {
  const logPath = join(directory, 'app.log')
  await writeFile(logPath, '{partial')
  const logger = new Logger(logPath)
  const events: LogStreamEvent[] = []
  const unsubscribe = await logger.subscribe((event) => events.push(event))
  await logger.log('joined')
  expect(events.map((event) => event.type)).toEqual(['ready', 'resync'])
  expect(await logger.readSnapshot()).toMatchObject({ total: 1, entries: [{ kind: 'raw' }] })
  await logger.log('independent')
  expect(events.at(-1)?.type).toBe('append')
  expect(await logger.readSnapshot()).toMatchObject({ total: 2 })
  unsubscribe()
}))

test('clearing a missing file does not create its parent', () => withTempDir(async (directory) => {
  const logPath = join(directory, 'missing', 'app.log')
  const logger = new Logger(logPath)
  expect(await logger.clear()).toMatchObject({ cursor: { revision: 1 } })
  await expect(access(join(directory, 'missing'))).rejects.toMatchObject({ code: 'ENOENT' })
}))

test('failed append and clear do not advance or publish; the queue recovers', () => withTempDir(async (directory) => {
  const logger = new Logger(join(directory, 'app.log'))
  const events: LogStreamEvent[] = []
  const unsubscribe = await logger.subscribe((event) => events.push(event))
  vi.mocked(appendFile).mockRejectedValueOnce(new Error('append denied'))
  await expect(logger.log('fail')).rejects.toThrow('append denied')
  await logger.log('keep')
  vi.mocked(truncate).mockRejectedValueOnce(new Error('truncate denied'))
  await expect(logger.clear()).rejects.toThrow('truncate denied')
  expect(await logger.readSnapshot()).toMatchObject({ cursor: { revision: 1 }, entries: [{ message: 'keep' }] })
  expect(events.map((event) => event.type)).toEqual(['ready', 'append'])
  unsubscribe()
}))

test('metadata read or subscriber failure cannot reject a successful append', () => withTempDir(async (directory) => {
  const logger = new Logger(join(directory, 'app.log'))
  const events: LogStreamEvent[] = []
  await logger.subscribe(() => { throw new Error('client failed') })
  const unsubscribe = await logger.subscribe((event) => events.push(event))
  vi.mocked(open).mockRejectedValueOnce(new Error('metadata denied'))
  await expect(logger.log('written')).resolves.toBeUndefined()
  expect(events.at(-1)?.type).toBe('resync')
  expect(await logger.readSnapshot()).toMatchObject({ entries: [{ message: 'written' }] })
  unsubscribe()
}))

test('stopAccepting rejects new commands and drains accepted work', () => withTempDir(async (directory) => {
  const logger = new Logger(join(directory, 'app.log'))
  const accepted = logger.log('accepted')
  const clearing = logger.clear()
  logger.stopAccepting()
  await expect(logger.log('late')).rejects.toMatchObject({ code: 'LOG_STORE_CLOSED' })
  await expect(logger.clear()).rejects.toMatchObject({ code: 'LOG_STORE_CLOSED' })
  await expect(logger.readSnapshot()).rejects.toMatchObject({ code: 'LOG_STORE_CLOSED' })
  await expect(logger.subscribe(() => undefined)).rejects.toMatchObject({ code: 'LOG_STORE_CLOSED' })
  await logger.flush()
  await Promise.all([accepted, clearing])
  expect(await readFile(join(directory, 'app.log'), 'utf8')).toBe('')
}))
