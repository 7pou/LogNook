import { realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve } from 'node:path'

interface StaticAssetHeaders {
  contentType: string
  cacheControl: string
}

export interface StaticAsset extends StaticAssetHeaders {
  filePath: string
}

export interface EmbeddedStaticAsset extends StaticAssetHeaders {
  content: string
}

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
}

function decodeStaticPath(pathname: string): string | null {
  if (/%(?:2f|5c)/i.test(pathname)) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some((part) => part === '.' || part === '..')) return null
  if (decoded !== '/' && !/^\/assets\/[A-Za-z0-9_-]+\.(js|css)$/.test(decoded)) return null
  return decoded
}

function staticAssetHeaders(pathname: string, filename = pathname === '/' ? 'index.html' : pathname): StaticAssetHeaders {
  return {
    contentType: contentTypes[extname(filename)]!,
    cacheControl: pathname !== '/' && /-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(pathname)
      ? 'public, max-age=31536000, immutable' : 'no-store',
  }
}

export function resolveEmbeddedAsset(assets: Readonly<Record<string, string>>, pathname: string): EmbeddedStaticAsset | null {
  const decoded = decodeStaticPath(pathname)
  if (decoded === null || !Object.hasOwn(assets, decoded)) return null
  return { content: assets[decoded]!, ...staticAssetHeaders(decoded) }
}

export async function resolveStaticAsset(webRoot: string, pathname: string): Promise<StaticAsset | null> {
  const decoded = decodeStaticPath(pathname)
  if (decoded === null) return null
  try {
    const root = await realpath(webRoot)
    const filePath = await realpath(resolve(root, decoded === '/' ? 'index.html' : decoded.slice(1)))
    const pathWithinRoot = relative(root, filePath)
    if (isAbsolute(pathWithinRoot) || pathWithinRoot === '..' || pathWithinRoot.startsWith('..\\') || pathWithinRoot.startsWith('../')) return null
    if (!(await stat(filePath)).isFile()) return null
    return {
      filePath,
      ...staticAssetHeaders(decoded, filePath),
    }
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return null
    throw error
  }
}
