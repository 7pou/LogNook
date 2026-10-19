import { isAbsolute, join, resolve } from 'node:path'
import type { LogViewerOptions, ResolvedLogViewerOptions } from './types'

export function resolveOptions(options: LogViewerOptions = {}): ResolvedLogViewerOptions {
  const { dir = './logs', filename = 'app.log', port = 8899, renderTitle, disableSafeRendering = false } = options
  if (typeof dir !== 'string' || dir.trim() === '') throw new TypeError('Invalid log directory')
  if (typeof filename !== 'string' || !filename.endsWith('.log') || /[/\\]/.test(filename) || isAbsolute(filename)) {
    throw new TypeError('Invalid log filename')
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Invalid server port')
  if (renderTitle !== undefined && typeof renderTitle !== 'function') throw new TypeError('Invalid title renderer')
  if (typeof disableSafeRendering !== 'boolean') throw new TypeError('Invalid safe rendering option')
  const directory = resolve(dir)
  return { directory, filename, logPath: join(directory, filename), port, disableSafeRendering, ...(renderTitle === undefined ? {} : { renderTitle }) }
}
