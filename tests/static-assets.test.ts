import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { resolveStaticAsset } from '../src/static-assets'
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
