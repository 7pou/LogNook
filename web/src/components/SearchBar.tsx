interface SearchBarProps {
  draft: string
  onDraftChange: (value: string) => void
  onSearch: () => void
  onClear: () => void
}

export function SearchBar({ draft, onDraftChange, onSearch, onClear }: SearchBarProps) {
  return (
    <form role="search" aria-label="日志搜索" className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); onSearch() }}>
      <label className="min-w-0 flex-1 font-semibold" htmlFor="query">
        关键词
        <input id="query" name="q" type="search" value={draft} onChange={(event) => onDraftChange(event.target.value)}
          placeholder="搜索标题或消息内容" className="mt-2 block h-10.5 w-full rounded border border-slate-400 bg-white px-3 font-normal" />
      </label>
      <div role="group" aria-label="搜索操作" className="grid grid-cols-2 gap-2 sm:flex sm:gap-3">
        <button type="submit" className="button-primary">搜索</button>
        <button type="button" className="button-secondary" onClick={onClear}>清空搜索</button>
      </div>
    </form>
  )
}
