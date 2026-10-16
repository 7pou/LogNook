import type { ClearLogsResponse, LogsSnapshot } from '../../src/log-types'
import { isLogCursor, isLogsSnapshot } from '../../src/log-protocol'
import { isRecordingSnapshot, type RecordingSnapshot } from '../../src/recording-protocol'

async function readResponse(response: Response): Promise<unknown> {
  let data: unknown
  try { data = await response.json() } catch {
    throw new Error(response.ok ? '日志服务返回了无效 JSON，请重新同步后重试。' : `日志请求失败（HTTP ${response.status}），请重试。`)
  }
  if (!response.ok) {
    const error = typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string' ? data.error : `日志请求失败（HTTP ${response.status}）`
    throw new Error(error)
  }
  return data
}

export async function fetchLogs(query: string, signal: AbortSignal): Promise<LogsSnapshot> {
  const response = await fetch(`/api/logs?${new URLSearchParams({ q: query })}`, { cache: 'no-store', signal })
  const data = await readResponse(response)
  if (!isLogsSnapshot(data)) throw new Error('日志服务返回的数据格式无效，请重新同步后重试。')
  return data
}

export async function clearLogs(clearToken: string, signal: AbortSignal): Promise<ClearLogsResponse> {
  const data = await readResponse(await fetch('/api/logs/clear', {
    method: 'POST', cache: 'no-store', signal, headers: { 'X-Log-Viewer-Token': clearToken },
  }))
  if (typeof data !== 'object' || data === null || !('cursor' in data) || !isLogCursor(data.cursor)) throw new Error('清空响应格式无效，请重新同步确认日志状态。')
  return { cursor: data.cursor }
}

function recordingResponse(data: unknown): RecordingSnapshot {
  if (!isRecordingSnapshot(data)) throw new Error('录制响应格式无效，请重新同步确认录制状态。')
  return { sessionId: data.sessionId, revision: data.revision, state: data.state }
}

export async function fetchRecording(signal: AbortSignal): Promise<RecordingSnapshot> {
  return recordingResponse(await readResponse(await fetch('/api/recording', { cache: 'no-store', signal })))
}

export async function updateRecording(action: 'pause' | 'resume', token: string, signal: AbortSignal): Promise<RecordingSnapshot> {
  if (action !== 'pause' && action !== 'resume') throw new Error('不支持的录制操作。')
  return recordingResponse(await readResponse(await fetch(`/api/recording/${action}`, {
    method: 'POST', cache: 'no-store', signal, headers: { 'X-Log-Viewer-Token': token },
  })))
}
