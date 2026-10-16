import { realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve } from 'node:path'

export interface StaticAsset {
  filePath: string
  contentType: string
  cacheControl: string
}

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
}

export async function resolveStaticAsset(webRoot: string, pathname: string): Promise<StaticAsset | null> {
  if (/%(?:2f|5c)/i.test(pathname)) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some((part) => part === '.' || part === '..')) return null
  if (decoded !== '/' && !/^\/assets\/[A-Za-z0-9_-]+\.(js|css)$/.test(decoded)) return null
  try {
    const root = await realpath(webRoot)
    const filePath = await realpath(resolve(root, decoded === '/' ? 'index.html' : decoded.slice(1)))
    const pathWithinRoot = relative(root, filePath)
    if (isAbsolute(pathWithinRoot) || pathWithinRoot === '..' || pathWithinRoot.startsWith('..\\') || pathWithinRoot.startsWith('../')) return null
    if (!(await stat(filePath)).isFile()) return null
    return {
      filePath,
      contentType: contentTypes[extname(filePath)]!,
      cacheControl: decoded !== '/' && /-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(decoded)
        ? 'public, max-age=31536000, immutable' : 'no-store',
    }
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return null
    throw error
  }
}
