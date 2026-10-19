export interface LogViewerOptions {
  dir?: string
  filename?: string
  port?: number
  filter?: (input: string | LogInput) => boolean
}

export interface LogInput {
  title?: string
  color?: string
  message: unknown
}

export interface ResolvedLogViewerOptions {
  directory: string
  filename: string
  logPath: string
  port: number
}

export interface ServerInfo {
  port: number
  url: string
}
