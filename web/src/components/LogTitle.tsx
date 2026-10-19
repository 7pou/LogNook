import { useMemo } from 'react'
import DOMPurify from 'dompurify'
import type { LogEntry } from '../../../src/log-types'

export function LogTitle({ entry, disableSafeRendering = false }: { entry: LogEntry; disableSafeRendering?: boolean }) {
  const html = useMemo(() => {
    if (entry.titleHtml === undefined || disableSafeRendering === true) return entry.titleHtml
    return DOMPurify.sanitize(entry.titleHtml, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['style', 'form', 'input', 'button', 'select', 'textarea', 'iframe', 'object', 'embed', 'img', 'video', 'audio', 'source', 'link', 'meta'],
      FORBID_ATTR: ['style', 'id', 'name', 'src', 'srcset', 'poster', 'background', 'ping'],
    })
  }, [entry.titleHtml, disableSafeRendering])
  if (html !== undefined) return <span dangerouslySetInnerHTML={{ __html: html }} />
  return <>{entry.kind === 'structured' ? entry.title ?? '日志' : '无法解析的日志'}</>
}
