interface ColorFilterProps {
  colors: readonly string[]
  selectedColors: readonly string[]
  onToggle: (color: string) => void
  onClear: () => void
}

export function ColorFilter({ colors, selectedColors, onToggle, onClear }: ColorFilterProps) {
  return (
    <div role="group" aria-label="颜色筛选" className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-200 pt-3">
      <span className="font-semibold">颜色</span>
      <div className="flex flex-wrap items-center gap-1">
        {colors.map((color) => (
          <button key={color} type="button" aria-label={`筛选颜色 ${color}`} title={color}
            aria-pressed={selectedColors.includes(color)} onClick={() => onToggle(color)}
            className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full hover:bg-slate-100">
            <span aria-hidden="true" className="inline-flex h-5 w-5 items-center justify-center rounded-full border-2 border-slate-400 ring-1 ring-slate-200 ring-offset-2 ring-offset-white" style={{ borderColor: color }}>
              {selectedColors.includes(color) && <span className="h-2.5 w-2.5 rounded-full bg-slate-400" style={{ backgroundColor: color, outline: '1px solid #94a3b8' }} />}
            </span>
          </button>
        ))}
      </div>
      <span aria-live="polite" className="text-xs text-slate-500">
        {selectedColors.length > 0 ? `已选 ${selectedColors.length} 色` : colors.length > 0 ? '未选择时显示全部' : '暂无带颜色的日志'}
      </span>
      <button type="button" onClick={onClear} disabled={selectedColors.length === 0}
        className="ml-auto min-h-9 cursor-pointer rounded px-2 text-xs text-blue-900 hover:bg-slate-100">清空颜色</button>
    </div>
  )
}
