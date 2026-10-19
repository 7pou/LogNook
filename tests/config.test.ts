import { access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, test } from 'vitest'
import { resolveOptions } from '../src/config'
import { withTempDir } from './helpers'
import type { LogViewerOptions } from '../src/types'

test('resolves defaults', () => {
  const directory = resolve(process.cwd(), 'logs')
  expect(resolveOptions()).toEqual({ directory, filename: 'app.log', logPath: join(directory, 'app.log'), port: 8899, disableSafeRendering: false })
})

test.each([123, null, 'html'])('rejects a non-function renderTitle %j', (renderTitle) => {
  expect(() => resolveOptions({ renderTitle } as unknown as LogViewerOptions)).toThrow(TypeError)
})

test.each([true, false])('resolves disableSafeRendering %s', (disableSafeRendering) => {
  const options = { disableSafeRendering }
  expect(resolveOptions(options).disableSafeRendering).toBe(disableSafeRendering)
})

test.each(['true', 0, null])('rejects non-boolean disableSafeRendering %j', (disableSafeRendering) => {
  expect(() => resolveOptions({ disableSafeRendering } as unknown as LogViewerOptions)).toThrow(TypeError)
})

test.each(['../app.log', 'nested/app.log', 'nested\\app.log', 'C:\\logs\\app.log', '/tmp/app.log', 'app.txt', ''])('rejects filename %s', (filename) => {
  expect(() => resolveOptions({ filename })).toThrow(TypeError)
})

test.each([-1, 65536, 1.5, NaN, Infinity])('rejects port %s', (port) => {
  expect(() => resolveOptions({ port })).toThrow(TypeError)
})

test.each(['', '   '])('rejects empty directory %s', (dir) => {
  expect(() => resolveOptions({ dir })).toThrow(TypeError)
})

test('accepts dynamic ports and resolves custom directory', () => {
  expect(resolveOptions({ dir: './custom', filename: 'custom.log', port: 0 })).toEqual({
    directory: resolve('./custom'), filename: 'custom.log', logPath: resolve('./custom/custom.log'), port: 0, disableSafeRendering: false,
  })
})

test('does not create directories or files', () => withTempDir(async (directory) => {
  const options = resolveOptions({ dir: join(directory, 'nested') })
  await expect(access(options.directory)).rejects.toMatchObject({ code: 'ENOENT' })
}))
