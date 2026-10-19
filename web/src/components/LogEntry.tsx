import type { LogEntry as LogEntryData } from '../../../src/log-types'
import { CopyMessageButton } from './CopyMessageButton'

export function LogEntry({ entry, showTime = true }: { entry: LogEntryData; showTime?: boolean }) {
  const message = entry.kind === 'raw' ? entry.raw
    : typeof entry.message === 'string' ? entry.message : JSON.stringify(entry.message, null, 2)
  const preview = message.replace(/\s+/g, ' ')

  return (
    <details className="group border-t border-slate-200 first:border-t-0 open:bg-blue-50/40">
      <summary className="grid cursor-pointer grid-cols-[12px_minmax(0,1fr)] items-baseline gap-2 p-4 md:grid-cols-[16px_180px_minmax(80px,160px)_minmax(0,1fr)] md:gap-3">
        <span aria-hidden="true" className="font-mono text-slate-500" style={entry.kind === 'structured' && entry.color ? { color: entry.color } : undefined}><span className="group-open:hidden">+</span><span className="hidden group-open:inline">−</span></span>
        {showTime && (entry.kind === 'structured'
          ? <time dateTime={entry.timestamp} className="text-xs text-slate-500">{new Date(entry.timestamp).toLocaleString()}</time>
          : <span className="text-xs text-slate-500">原始记录</span>)}
        <span className={`col-start-2 font-semibold wrap-anywhere ${showTime ? 'md:col-start-auto' : 'md:col-span-2'}`}>{entry.kind === 'structured' ? entry.title ?? '日志' : '无法解析的日志'}</span>
        <span className="col-start-2 flex min-w-0 items-center gap-2 text-slate-500 md:col-start-auto">
          <span className="min-w-0 flex-1 truncate">{preview}</span>
          <CopyMessageButton message={message} />
        </span>
      </summary>
      <div className="border-t border-slate-200 px-5 py-4 md:pr-6 md:pb-5 md:pl-11">
        <pre className="font-mono text-[13px] leading-7 whitespace-pre-wrap wrap-anywhere">{message}</pre>
      </div>
    </details>
  )
}
