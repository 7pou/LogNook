import { readFile } from 'node:fs/promises'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import type { ResolvedLogViewerOptions, ServerInfo } from './types'
import { Logger, LogStoreClosedError } from './logger'
import { SseConnections } from './sse-connections'
import { resolveStaticAsset } from './static-assets'
import type { RecordingControls } from './recording-protocol'

function isLocalRequest(request: IncomingMessage): boolean {
  const host = request.headers.host
  if (!host || !/^(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(host)) return false
  try {
    const origin = new URL(`http://${host}`).origin
    return request.headers.origin === undefined || request.headers.origin === origin
  } catch { return false }
}

export class HtmlServer {
  private server?: Server
  private starting?: Promise<ServerInfo>
  private stopping?: Promise<void>
  private streams = new SseConnections()
  private readonly clearToken = randomBytes(16).toString('hex')

  constructor(
    private readonly options: ResolvedLogViewerOptions,
    private readonly webRoot = fileURLToPath(new URL('./web/', import.meta.url)),
    private readonly logger = new Logger(options.logPath),
    private readonly recording?: RecordingControls,
  ) {}

  run(): Promise<ServerInfo> {
    if (this.stopping) return this.stopping.then(() => this.run())
    if (this.starting) return this.starting
    this.streams = new SseConnections()
    const server = createServer((request, response) => {
      this.handleRequest(request, response).catch(() => {
        if (response.headersSent) {
          response.destroy()
        } else {
          response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
          response.end('日志服务处理请求失败')
        }
      })
    })
    this.server = server
    this.starting = new Promise<ServerInfo>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.options.port, '127.0.0.1', () => {
        server.off('error', reject)
        server.on('error', (error) => console.error('Log viewer server error:', error))
        const address = server.address()
        if (address === null || typeof address === 'string') {
          reject(new Error('Log viewer did not bind a TCP port'))
          return
        }
        resolve({ port: address.port, url: `http://127.0.0.1:${address.port}/` })
      })
    }).catch((error: unknown) => {
      this.server = undefined
      this.starting = undefined
      throw error
    })
    return this.starting
  }

  close(): Promise<void> {
    if (this.stopping) return this.stopping
    const server = this.server
    if (!server) return Promise.resolve()
    this.streams.close()
    const starting = this.starting
    this.stopping = (async () => {
      await starting?.catch(() => undefined)
      if (server.listening) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve())
        })
      }
      this.server = undefined
      this.starting = undefined
    })().finally(() => {
      this.stopping = undefined
    })
    return this.stopping
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const rawPath = (request.url ?? '/').split('?')[0]!
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    if (!isLocalRequest(request)) {
      this.json(response, 403, { error: '仅允许本机同源请求。' }, request.method === 'HEAD')
      return
    }
    const recordingRoute = rawPath === '/api/recording' || rawPath === '/api/recording/pause' || rawPath === '/api/recording/resume'
    const recordingAction = rawPath === '/api/recording/pause' || rawPath === '/api/recording/resume'
    if (rawPath === '/api/logs' || rawPath === '/api/events' || rawPath === '/api/logs/clear' || recordingRoute) {
      const allowed = rawPath === '/api/events' ? ['GET'] : rawPath === '/api/logs/clear' || recordingAction ? ['POST'] : ['GET', 'HEAD']
      if (!allowed.includes(request.method ?? '')) {
        response.setHeader('Allow', allowed.join(', '))
        this.json(response, 405, { error: '不支持的请求方法。' }, request.method === 'HEAD')
        return
      }
      if (rawPath !== '/api/logs' && (url.search.length > 0 || request.headers['transfer-encoding'] !== undefined || Number(request.headers['content-length'] ?? 0) !== 0)) {
        this.json(response, 400, { error: '此接口不接受查询参数或请求体。' })
        return
      }
      if (rawPath === '/api/logs/clear' || recordingAction) {
        const token = request.headers['x-log-viewer-token']
        if (typeof token !== 'string' || !/^[a-f0-9]{32}$/.test(token) || !timingSafeEqual(Buffer.from(token), Buffer.from(this.clearToken))) {
          this.json(response, 403, { error: recordingAction ? '录制控制令牌无效，请重新同步后重试。' : '清空令牌无效，请重新同步后重试。' })
          return
        }
      }
      try {
        if (rawPath === '/api/events') {
          await this.streams.connect(response, (listener) => this.logger.subscribe(listener), this.recording)
        } else if (recordingRoute) {
          if (!this.recording) {
            this.json(response, 503, { error: '录制控制不可用。' }, request.method === 'HEAD')
            return
          }
          this.recording.getSnapshot()
          if (rawPath === '/api/recording/pause') this.recording.pause()
          if (rawPath === '/api/recording/resume') this.recording.resume()
          this.json(response, 200, this.recording.getSnapshot(), request.method === 'HEAD')
        } else if (rawPath === '/api/logs/clear') {
          this.json(response, 200, await this.logger.clear())
        } else {
          const snapshot = await this.logger.readSnapshot(url.searchParams.get('q') ?? '')
          this.json(response, 200, { filename: this.options.filename, clearToken: this.clearToken, ...snapshot }, request.method === 'HEAD')
        }
      } catch (error) {
        if (response.headersSent) { response.destroy(); return }
        const closed = error instanceof LogStoreClosedError
        this.json(response, closed ? 503 : 500, { error: closed ? '日志服务正在关闭。' : recordingRoute ? '无法控制录制，请重新同步后重试。' : rawPath === '/api/logs/clear' ? '无法清空日志，请检查文件权限后重试。' : '无法读取日志，请检查目录和文件权限后重新同步。' }, request.method === 'HEAD')
      }
      return
    }
    const asset = await resolveStaticAsset(this.webRoot, rawPath)
    if (rawPath !== '/' && !asset) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('页面不存在')
      return
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('只支持 GET 和 HEAD 请求')
      return
    }
    if (!asset) {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end(request.method === 'HEAD' ? undefined : '缺少 Web 构建产物，请先执行 pnpm run build。')
      return
    }
    const content = await readFile(asset.filePath)
    response.writeHead(200, {
      'Content-Type': asset.contentType,
      'Cache-Control': asset.cacheControl,
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    })
    response.end(request.method === 'HEAD' ? undefined : content)
  }

  private json(response: ServerResponse, status: number, value: unknown, head = false): void {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    response.end(head ? undefined : JSON.stringify(value))
  }
}
