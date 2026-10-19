import { useMemo } from 'react'
import { collapseAllNested, defaultStyles, JsonView } from 'react-json-view-lite'
import 'react-json-view-lite/dist/index.css'

const jsonStyles = {
  ...defaultStyles,
  container: 'font-mono text-[13px] leading-7 whitespace-pre-wrap wrap-anywhere',
  basicChildStyle: '',
  label: 'mr-1 font-semibold text-slate-700',
  stringValue: 'text-emerald-700',
  numberValue: 'text-blue-700',
  booleanValue: 'text-violet-700',
  nullValue: 'text-slate-500',
  punctuation: 'text-slate-500',
  quotesForFieldNames: true,
  stringifyStringValues: true,
  ariaLables: { collapseJson: '收起 JSON', expandJson: '展开 JSON' },
}

export function JsonMessage({ message, text }: { message: unknown; text: string }) {
  const data: unknown = useMemo(() => {
    if (typeof message !== 'string') return message
    try {
      return JSON.parse(message)
    } catch {
      return message
    }
  }, [message])

  return data !== null && typeof data === 'object'
    ? <JsonView data={data} style={jsonStyles} shouldExpandNode={collapseAllNested} aria-label="JSON 消息" />
    : <pre className="font-mono text-[13px] leading-7 whitespace-pre-wrap wrap-anywhere">{text}</pre>
}
