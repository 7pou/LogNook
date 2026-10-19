import { useEffect, useState, type MouseEvent } from 'react'

export function CopyMessageButton({ message }: { message: string }) {
  const [state, setState] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle')

  useEffect(() => {
    if (state !== 'copied') return
    const timer = setTimeout(() => setState('idle'), 2000)
    return () => clearTimeout(timer)
  }, [state])

  async function copy(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    setState('copying')
    try {
      await navigator.clipboard.writeText(message)
      setState('copied')
    } catch {
      setState('error')
    }
  }

  const title = state === 'copied' ? '已复制' : state === 'error' ? '复制失败，请重试或手动选择消息复制'
    : state === 'copying' ? '正在复制' : '复制消息'

  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <button type="button" aria-label="复制消息" title={title} aria-busy={state === 'copying'}
        disabled={state === 'copying'} onClick={copy}
        className={`inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded hover:bg-slate-100 ${state === 'copied' ? 'text-emerald-700' : state === 'error' ? 'text-red-700' : 'text-slate-500 hover:text-blue-900'}`}>
        <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          {state === 'copied' ? <path d="m5 12 4 4L19 6" /> : <>
            <rect x="9" y="9" width="12" height="12" rx="2" />
            <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
          </>}
        </svg>
      </button>
      {(state === 'copied' || state === 'error') && (
        <span role="status" className={`text-xs whitespace-nowrap ${state === 'copied' ? 'text-emerald-700' : 'text-red-700'}`}>
          {state === 'copied' ? '已复制' : '复制失败，请重试'}
        </span>
      )}
    </span>
  )
}
