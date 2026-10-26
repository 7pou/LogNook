import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { TsdownPlugin } from 'tsdown'

export async function readWebAssets(webRoot: string): Promise<Record<string, string>> {
  let html: string
  try {
    html = await readFile(join(webRoot, 'index.html'), 'utf8')
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      throw new Error('Missing web build. Run pnpm run build:web before building the library.', { cause: error })
    }
    throw error
  }
  const assets: Record<string, string> = { '/': html }
  const entries = await readdir(join(webRoot, 'assets'), { withFileTypes: true }).catch((error: unknown) => {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return []
    throw error
  })
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !/^[A-Za-z0-9_-]+\.(js|css)$/.test(entry.name)) continue
    assets[`/assets/${entry.name}`] = await readFile(join(webRoot, 'assets', entry.name), 'utf8')
  }
  return assets
}

export function embeddedWebAssetsPlugin(assetModule: string, webRoot: string): TsdownPlugin {
  return {
    name: 'lognook-embedded-web-assets',
    async load(id) {
      if (resolve(id) !== resolve(assetModule)) return
      const assets = await readWebAssets(webRoot)
      this.addWatchFile(webRoot)
      for (const pathname of Object.keys(assets)) {
        this.addWatchFile(join(webRoot, pathname === '/' ? 'index.html' : pathname.slice(1)))
      }
      return { code: `export const webAssets = ${JSON.stringify(assets)}`, moduleType: 'js' }
    },
  }
}
