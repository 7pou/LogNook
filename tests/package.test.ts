import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { expect, test } from 'vitest'

test('uses the lognook package identity consistently across workspace commands', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const web = JSON.parse(readFileSync(new URL('../web/package.json', import.meta.url), 'utf8'))
  expect(manifest.name).toBe('lognook')
  expect(web.name).toBe('@lognook/web')
  expect(web.private).toBe(true)
  for (const command of ['build', 'dev', 'test', 'typecheck']) {
    expect(manifest.scripts[`${command}:web`]).toBe(`pnpm --filter @lognook/web ${command}`)
  }
})

test('documents package usage without internal requirements or implementation plans', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  expect(readme).toMatch(/^# LogNook\r?\n/)
  expect(readme).toContain("import { LogViewer } from 'lognook'")
  expect(readme).not.toContain('tsdown-starter')
  expect(readme).toContain('npm install lognook')
  expect(readme).toContain('Node.js >= 22.0.0')
  const webRequire = createRequire(new URL('../web/package.json', import.meta.url))
  const testRuntime = JSON.parse(readFileSync(webRequire.resolve('jsdom/package.json'), 'utf8')).engines.node
  expect(readme).toContain(`Node.js \`${testRuntime}\``)
  expect(readme).toContain('filter?: (input: string | LogInput) => boolean')
  expect(readme).not.toMatch(/\]\(docs\//)
  expect(readme).not.toContain('docs/superpowers/')
  expect(readme).not.toMatch(/需求文档|完整需求|实现计划|验收标准|实施记录/)
})

test('uses LogNook in the browser document title', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8')
  expect(html).toContain('<title>LogNook 日志查看器</title>')
})

test('declares stable ESM and type entry points', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  expect(manifest.exports['.']).toEqual({ types: './dist/index.d.mts', import: './dist/index.mjs' })
  expect(manifest.files).toEqual(['dist', 'LICENSE', 'THIRD_PARTY_NOTICES.md'])
})

test('builds and validates the library and web without Node runtime dependencies', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  expect(manifest.scripts.build).toBe('pnpm run build:lib && pnpm run build:web')
  expect(manifest.scripts.test).toBe('pnpm run test:lib && pnpm run test:web')
  expect(manifest.scripts.typecheck).toBe('pnpm run typecheck:lib && pnpm run typecheck:web')
  expect(manifest.scripts.prepublishOnly).toBe('pnpm test && pnpm run typecheck && pnpm run build && pnpm run test:types')
  expect(manifest.dependencies ?? {}).toEqual({})
})

test('declares a maintained Node runtime floor without changing the package version', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  expect(manifest.engines).toEqual({ node: '>=22.0.0' })
  expect(manifest.license).toBe('MIT')
})

test('ships the project MIT license with an actual copyright holder', () => {
  const license = readFileSync(new URL('../LICENSE', import.meta.url), 'utf8')
  expect(license).toContain('MIT License')
  expect(license).toContain('7pou')
  expect(license).toContain('Permission is hereby granted, free of charge')
  expect(license).toContain('THE SOFTWARE IS PROVIDED "AS IS"')
})

test('retains exact installed third-party license texts and versions for the web bundle', () => {
  const notices = readFileSync(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const webRequire = createRequire(new URL('../web/package.json', import.meta.url))
  const domRequire = createRequire(webRequire.resolve('react-dom/package.json'))
  for (const name of ['react', 'react-dom', 'scheduler', 'tailwindcss']) {
    const resolver = name === 'scheduler' ? domRequire : webRequire
    const metadataPath = resolver.resolve(`${name}/package.json`)
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
    const license = readFileSync(join(dirname(metadataPath), 'LICENSE'), 'utf8').replace(/\r\n/g, '\n').trim()
    expect(notices).toContain(`- ${name}@${metadata.version}`)
    expect(notices).toContain(license)
  }
})
