import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { readWebAssets } from '../scripts/embed-web-assets'
import { createWebFixture, withTempDir } from './helpers'

test('collects built HTML, JS and CSS without exposing other files or directories', () => withTempDir(async (directory) => {
  const webRoot = await createWebFixture(directory)
  await writeFile(join(webRoot, 'assets', 'private.json'), '{"private": true}')
  await mkdir(join(webRoot, 'assets', 'directory.js'))
  expect(await readWebAssets(webRoot)).toEqual({
    '/': '<html><body><div id="root"></div><script type="module" src="/assets/index-a1b2c3d4.js"></script></body></html>',
    '/assets/index-a1b2c3d4.css': 'body { color: black }',
    '/assets/index-a1b2c3d4.js': 'export const fixture = true',
  })
}))

test('preserves Unicode and quoted resource content', () => withTempDir(async (directory) => {
  const webRoot = await createWebFixture(directory)
  await writeFile(join(webRoot, 'assets', 'runtime.js'), 'const message = "日志 \\\"内容\\\"";\n')
  expect((await readWebAssets(webRoot))['/assets/runtime.js']).toBe('const message = "日志 \\\"内容\\\"";\n')
}))

test('supports an HTML-only build', () => withTempDir(async (directory) => {
  await writeFile(join(directory, 'index.html'), '<html>no scripts</html>')
  expect(await readWebAssets(directory)).toEqual({ '/': '<html>no scripts</html>' })
}))

test('fails with a build instruction when the web entry is missing', () => withTempDir(async (directory) => {
  await expect(readWebAssets(directory)).rejects.toThrow('Run pnpm run build:web')
}))
