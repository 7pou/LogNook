import type { LogEntry as LogEntryData } from '../../../src/log-types'
import { LogEntry } from './LogEntry'
import { getEntryColor } from '../../../src/log-colors'

interface LogListProps {
  entries: LogEntryData[]
  total: number
  matched: number
  batch: number
  showTime: boolean
  onShowTimeChange: (showTime: boolean) => void
  selectedColors?: readonly string[]
  disableSafeRendering?: boolean
}

export function LogList({ entries, total, matched, batch, showTime, onShowTimeChange, selectedColors = [], disableSafeRendering = false }: LogListProps) {
  const visibleEntries = entries.map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => selectedColors.length === 0 || selectedColors.includes(getEntryColor(entry) ?? ''))
  const visibleMatched = selectedColors.length > 0 ? visibleEntries.length : matched
  return (
    <>
      <div className="mt-6 mb-3 flex flex-col justify-between gap-1.5 text-[13px] text-slate-500 sm:flex-row sm:items-center sm:gap-4">
        <output aria-live="polite" className="font-semibold text-slate-800">匹配 {visibleMatched} / 共 {total} 条</output>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>按写入顺序显示，点击记录展开详情</span>
          <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 whitespace-nowrap text-slate-700">
            <input type="checkbox" checked={showTime} onChange={(event) => onShowTimeChange(event.target.checked)} className="h-4 w-4 accent-blue-900" />
            显示时间
          </label>
        </div>
      </div>
      <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
        {visibleEntries.length > 0 ? visibleEntries.map(({ entry, index }) => <LogEntry key={`${batch}:${index}`} entry={entry} showTime={showTime} disableSafeRendering={disableSafeRendering} />)
          : <div role="status" className="px-6 py-9 text-slate-500">{total === 0 ? '暂无日志' : '没有匹配的日志'}</div>}
      </div>
    </>
  )
}
