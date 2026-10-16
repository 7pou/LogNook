import { useId, useRef } from 'react'

interface ClearLogsButtonProps {
  filename?: string
  disabled: boolean
  clearing: boolean
  error: string | null
  onConfirm: () => Promise<boolean>
}

export function ClearLogsButton({ filename, disabled, clearing, error, onConfirm }: ClearLogsButtonProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  function open() { dialog.current?.showModal(); cancel.current?.focus() }
  async function confirm() { if (!disabled && !clearing && await onConfirm()) dialog.current?.close() }

  return <>
    <button ref={opener} type="button" disabled={disabled} className="button-danger" onClick={open}>清空日志</button>
    <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border border-slate-300 bg-white p-6 text-slate-800 shadow-xl backdrop:bg-slate-900/40"
      onCancel={(event) => { if (clearing) event.preventDefault() }} onClose={() => opener.current?.focus()}>
      <h2 id={titleId} className="text-lg font-semibold">清空日志确认</h2>
      <p id={descriptionId} className="mt-3 leading-7 wrap-anywhere">将清空文件 <strong className="font-mono">{filename ?? '当前日志文件'}</strong> 的全部日志，不仅是搜索结果。此操作不可恢复，所有已打开的页面会同步清空；搜索条件保留。</p>
      {error && <p role="alert" className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-red-800">{error}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-3">
        <button ref={cancel} type="button" disabled={clearing} className="button-secondary" onClick={() => dialog.current?.close()}>取消</button>
        <button type="button" disabled={disabled || clearing} aria-busy={clearing} className="button-danger" onClick={() => void confirm()}>{clearing ? '正在清空…' : '确认清空'}</button>
      </div>
    </dialog>
  </>
}
