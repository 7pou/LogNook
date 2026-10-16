import { LogViewer } from 'lognook'
import type { LogInput, LogViewerOptions } from 'lognook'

const options: LogViewerOptions = { dir: './logs', filename: 'app.log', port: 0 }
const viewer = new LogViewer(options)
const input: LogInput = { title: '对象', message: { id: 123 } }
const writing: Promise<void> = viewer.log(input)
const serving: Promise<{ port: number; url: string }> = viewer.server()
const pausing: void = viewer.pause()
const resuming: void = viewer.resume()
const closing: Promise<void> = viewer.close()
void [writing, serving, pausing, resuming, closing]
