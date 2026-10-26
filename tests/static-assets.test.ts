import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { resolveEmbeddedAsset, resolveStaticAsset } from '../src/static-assets'
import { createWebFixture, withTempDir } from './helpers'

test('resolves entry and hashed JS/CSS with correct caching', () => withTempDir(async (directory) => {
  const webRoot = await createWebFixture(directory)
  expect(await resolveStaticAsset(webRoot, '/')).toMatchObject({ contentType: 'text/html; charset=utf-8', cacheControl: 'no-store' })
  expect(await resolveStaticAsset(webRoot, '/assets/index-a1b2c3d4.js')).toMatchObject({ contentType: 'text/javascript; charset=utf-8', cacheControl: 'public, max-age=31536000, immutable' })
  expect(await resolveStaticAsset(webRoot, '/assets/index-a1b2c3d4.css')).toMatchObject({ contentType: 'text/css; charset=utf-8' })
}))

test.each(['/assets/../secret.js', '/assets/%2e%2e%2fsecret.js', '/assets/%5c..%5csecret.js', '/assets/file%00.js', '/assets/%GG.js', '/src/index.ts', '/assets/missing.js'])('rejects unsafe or missing resource %s', (pathname) => withTempDir(async (directory) => {
  expect(await resolveStaticAsset(await createWebFixture(directory), pathname)).toBeNull()
}))

test('rejects asset directory links that escape the real web root', () => withTempDir(async (directory) => {
  const webRoot = join(directory, 'web')
  const outside = join(directory, 'private')
  await mkdir(webRoot)
  await mkdir(outside)
  await writeFile(join(outside, 'secret-a1b2c3d4.js'), 'private content')
  await symlink(outside, join(webRoot, 'assets'), 'junction')
  expect(await resolveStaticAsset(webRoot, '/assets/secret-a1b2c3d4.js')).toBeNull()
}))

test('does not cache non-hashed assets immutably', () => withTempDir(async (directory) => {
  const webRoot = await createWebFixture(directory)
  await writeFile(join(webRoot, 'assets', 'runtime.js'), 'export {}')
  expect(await resolveStaticAsset(webRoot, '/assets/runtime.js')).toMatchObject({ cacheControl: 'no-store' })
}))

const embeddedAssets = {
  '/': '<html>embedded viewer</html>',
  '/assets/index-a1b2c3d4.js': 'export const embedded = true',
  '/assets/index-a1b2c3d4.css': 'body { color: black }',
  '/assets/runtime.js': '',
  '/secret.js': 'not public',
}

test('resolves embedded entry, scripts and styles with the filesystem cache policy', () => {
  expect(resolveEmbeddedAsset(embeddedAssets, '/')).toEqual({
    content: '<html>embedded viewer</html>', contentType: 'text/html; charset=utf-8', cacheControl: 'no-store',
  })
  expect(resolveEmbeddedAsset(embeddedAssets, '/assets/index-a1b2c3d4.js')).toEqual({
    content: 'export const embedded = true', contentType: 'text/javascript; charset=utf-8', cacheControl: 'public, max-age=31536000, immutable',
  })
  expect(resolveEmbeddedAsset(embeddedAssets, '/assets/index-a1b2c3d4.css')).toEqual({
    content: 'body { color: black }', contentType: 'text/css; charset=utf-8', cacheControl: 'public, max-age=31536000, immutable',
  })
  expect(resolveEmbeddedAsset(embeddedAssets, '/assets/runtime.js')).toEqual({
    content: '', contentType: 'text/javascript; charset=utf-8', cacheControl: 'no-store',
  })
})

test('decodes safe embedded asset names before looking them up', () => {
  expect(resolveEmbeddedAsset(embeddedAssets, '/assets/%69ndex-a1b2c3d4.js')?.content).toBe('export const embedded = true')
})

test.each(['/assets/../secret.js', '/assets/%2e%2e%2fsecret.js', '/assets/%5c..%5csecret.js', '/assets/file%00.js', '/assets/%GG.js', '/src/index.ts', '/assets/missing.js', '/secret.js', '/index.html'])(
  'rejects unsafe, unapproved or missing embedded resource %s',
  (pathname) => expect(resolveEmbeddedAsset(embeddedAssets, pathname)).toBeNull(),
)

test('does not serve inherited embedded entries', () => {
  expect(resolveEmbeddedAsset(Object.create(embeddedAssets), '/assets/index-a1b2c3d4.js')).toBeNull()
})
