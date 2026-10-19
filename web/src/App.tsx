import { useEffect, useState } from 'react'
import { LogList } from './components/LogList'
import { SearchBar } from './components/SearchBar'
import { useLogs } from './useLogs'
import { useClearLogs } from './useClearLogs'
import { ClearLogsButton } from './components/ClearLogsButton'
import { RecordingButton } from './components/RecordingButton'
import { useRecording } from './useRecording'
import { ColorFilter } from './components/ColorFilter'
import { getLogColors } from '../../src/log-colors'

function readQuery(): string {
  return (new URL(window.location.href).searchParams.get('q') ?? '').trim()
}

export default function App() {
  const [query, setQuery] = useState(readQuery)
  const [draft, setDraft] = useState(readQuery)
  const [refreshKey, setRefreshKey] = useState(0)
  const [showTime, setShowTime] = useState(true)
  const [selectedColors, setSelectedColors] = useState<string[]>([])
  const { data, loading, error, batch, connection, recording, recordingError, applyClear, applyRecording } = useLogs(query, refreshKey)
  const colors = [...new Set([...(data?.colors ?? getLogColors(data?.entries ?? [])), ...selectedColors])]
  const canClear = data !== null && !loading && connection === 'live'
  const clearing = useClearLogs(data, canClear, applyClear)
  const recordingControl = useRecording(recording, data, canClear, applyRecording, recordingError)
  const connectionLabel = {
    connecting: '正在连接…', syncing: '正在同步…', live: '实时连接',
    reconnecting: '连接中断，正在重连…', error: '同步失败，可重新同步。',
  }[connection]
  const recordingLabel = recording?.state === 'pause' ? '已停止录制' : recording?.state === 'open' ? '录制中' : '录制状态待同步'
  const refresh = () => setRefreshKey((previous) => previous + 1)

  useEffect(() => {
    const restoreQuery = () => {
      const previous = readQuery()
      setQuery(previous)
      setDraft(previous)
    }
    window.addEventListener('popstate', restoreQuery)
    return () => window.removeEventListener('popstate', restoreQuery)
  }, [])

  function submit(value: string) {
    const next = value.trim()
    const url = new URL(window.location.href)
    if (next) url.searchParams.set('q', next)
    else url.searchParams.delete('q')
    if (url.href !== window.location.href) window.history.pushState(null, '', url)
    setQuery(next)
    setDraft(next)
    if (next === query) refresh()
  }

  function toggleColor(color: string) {
    setSelectedColors((previous) => previous.includes(color) ? previous.filter((selected) => selected !== color) : [...previous, color])
  }

  return (
    <main className="mx-auto max-w-[1180px] px-4 py-6 md:px-8 md:py-11">
      <header className="mb-7.5 flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
        <div>
          <h1 className="mb-2 text-[28px] font-semibold tracking-tight">LogNook 日志查看器</h1>
          <p className="leading-relaxed text-slate-500">查看本地记录，展开详情，搜索你需要的内容。</p>
        </div>
        {data && <div className="max-w-full rounded bg-blue-100/70 px-3.5 py-2.5 font-mono text-blue-900 wrap-anywhere sm:max-w-[45%]">{data.filename}</div>}
      </header>
      <section aria-label="日志工具栏" className="rounded-md border border-slate-200 bg-white">
        <div className="flex flex-col gap-4 border-b border-slate-200 px-3 py-3 sm:px-4 sm:py-4 md:flex-row md:items-center md:justify-between">
          <div role="group" aria-label="日志状态" aria-live="polite" className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span>{connectionLabel}</span>
            <span aria-hidden="true" className="h-3 w-px bg-slate-300" />
            <span>{recordingLabel}</span>
          </div>
          <div role="group" aria-label="全局操作" className="flex flex-wrap items-center gap-2 max-[360px]:grid max-[360px]:grid-cols-2 sm:gap-3">
            <button type="button" className="button-secondary" onClick={refresh} aria-busy={loading}>重新同步</button>
            <RecordingButton state={recording?.state} action={recordingControl.action} disabled={recordingControl.disabled} onToggle={recordingControl.toggle} />
            <div className="border-l border-slate-200 pl-2 max-[360px]:col-span-2 max-[360px]:border-t max-[360px]:border-l-0 max-[360px]:pt-2 max-[360px]:pl-0 max-[360px]:[&>button]:w-full sm:pl-3">
              <ClearLogsButton filename={data?.filename} disabled={!canClear || clearing.clearing} clearing={clearing.clearing} error={clearing.error} onConfirm={clearing.clear} />
            </div>
          </div>
        </div>
        <div className="px-3 py-4 sm:px-4">
          <SearchBar draft={draft} onDraftChange={setDraft} onSearch={() => submit(draft)} onClear={() => submit('')} />
          {data && <ColorFilter colors={colors} selectedColors={selectedColors} onToggle={toggleColor} onClear={() => setSelectedColors([])} />}
        </div>
      </section>
      {recordingControl.error && <p role="alert" className="mt-3 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 wrap-anywhere">{recordingControl.error}</p>}
      {loading && <p role="status" className="mt-6 text-slate-500">{data ? '正在同步，保留上次读取结果…' : '正在读取日志…'}</p>}
      {error && <div role="alert" className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded border border-red-200 bg-red-50 p-4 text-red-800">
        <div><p>{error}</p>{data && <p className="mt-1 text-xs">读取失败，当前显示上次成功读取的结果。</p>}</div>
        <button type="button" className="button-secondary" onClick={refresh}>重试</button>
      </div>}
      {data && <LogList entries={data.entries} total={data.total} matched={data.matched} batch={batch} showTime={showTime} onShowTimeChange={setShowTime} selectedColors={selectedColors} disableSafeRendering={data.disableSafeRendering === true} />}
      <footer className="mt-5 text-xs leading-relaxed text-slate-500">仅供本机调试。本实例的新日志实时追加，重连后重新同步；时间按浏览器本地时区显示。</footer>
    </main>
  )
}
