import type { RecordingState } from '../../../src/recording-protocol'

interface RecordingButtonProps {
  state?: RecordingState
  action: 'pause' | 'resume' | null
  disabled: boolean
  onToggle: () => Promise<void>
}

export function RecordingButton({ state, action, disabled, onToggle }: RecordingButtonProps) {
  const label = action === 'pause' ? '正在停止…' : action === 'resume' ? '正在恢复…' : state === 'pause' ? '继续录制' : '停止录制'
  return <button type="button" className="button-secondary" disabled={disabled} aria-busy={action !== null} onClick={() => void onToggle()}>{label}</button>
}
