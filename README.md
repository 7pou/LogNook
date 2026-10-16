# LogNook

一个面向任意 Node.js 项目的通用日志查看包：通过代码记录日志，将日志保存到文件，并通过本机网页浏览和搜索。

> 提供 ESM 产物和 TypeScript 类型声明，支持 SSE 实时追加、录制控制与确认后清空日志，面向本机调试场景。

## 安装与运行环境

运行时要求 Node.js >= 22.0.0，仅支持 ESM 导入，不提供 CommonJS `require()` 入口。

正式发布到 npm 后，可使用以下命令安装；发布前可本地构建或安装 `npm pack` 生成的压缩包验证。

```sh
npm install lognook
```

网页资源随 npm 包提供，使用者无需安装 React、Tailwind CSS 或启动 Vite。项目采用 [MIT 许可证](LICENSE)，已打包依赖的许可见 [第三方许可说明](THIRD_PARTY_NOTICES.md)。

## 功能

- 支持字符串日志，以及带可选标题的结构化消息。
- 日志自动记录时间，按调用顺序追加到同一文件。
- 写日志与 Web 服务独立，不启动服务也能记录日志。
- 网页支持日志列表、详情展开、JSON 格式化、关键词搜索和 SSE 实时追加。
- 提供独立的“清空日志”确认入口；清空整个当前文件，所有页面同步，保留各自的搜索条件。
- 提供明确的异步完成语义、错误反馈和资源关闭能力。

## API

```ts
interface LogViewerOptions {
  dir?: string
  filename?: string
  port?: number
  filter?: (input: string | LogInput) => boolean
}

interface LogInput {
  title?: string
  message: unknown
}

class LogViewer {
  constructor(options?: LogViewerOptions)

  log(input: string | LogInput): Promise<void>
  server(): Promise<{ port: number; url: string }>
  pause(): void
  resume(): void
  close(): Promise<void>
}
```

`message` 使用 `unknown` 接收字符串或可 JSON 序列化的数据；不是任意 JavaScript 值都能保存。循环引用、`BigInt` 和不能形成有效消息的值会被拒绝写入。

## 配置

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `dir` | `./logs` | 日志目录；相对路径以创建实例时的工作目录为基准 |
| `filename` | `app.log` | 日志文件名；不包含目录，不自动按日期切换文件 |
| `port` | `8899` | 本机 Web 服务端口；支持 `0` 由系统分配可用端口 |
| `filter` | 无 | 同步接收原始字符串或 `LogInput`；仅明确返回 `false` 时跳过该条日志 |

默认只监听 `127.0.0.1`，不提供远程访问配置。

`filter` 在序列化和文件写入前执行，跳过时 `log()` 返回已完成的 `Promise<void>`，不写文件也不推送事件。暂停录制时不执行过滤器。过滤器应同步返回，避免抛出异常；抛出的异常会从 `log()` 同步传播，不会变为异步拒绝。

## 使用示例

npm 包名为 `lognook`；本地构建后也可用 `import { LogViewer } from './dist/index.mjs'` 直接运行。

```ts
import { LogViewer } from 'lognook'

const viewer = new LogViewer({
  dir: './logs',
  filename: 'app.log',
  port: 8899,
})

try {
  await viewer.log('服务启动成功')

  await viewer.log({
    title: '用户信息',
    message: { id: 123, name: 'Alice' },
  })

  const { url } = await viewer.server()
  console.log(`日志查看地址：${url}`)
} catch (error) {
  console.error('日志操作失败：', error)
  await viewer.close()
}
```

示例启动服务后供应用继续运行；应用退出前应调用 `await viewer.close()`，等待日志写入完成并释放服务端口。

## 行为约定

- 仅导入包或创建实例，不启动服务、不创建日志目录或文件。
- 首次写入时自动创建目录；已有文件采用追加写入，不覆盖。
- 被接受写入的 `log()` 完成表示该条日志的文件写入操作已完成，不承诺断电后的物理持久化；暂停期间的调用直接成功返回，但不写入。
- `server()` 完成表示监听成功，返回实际端口与 URL；重复调用不重复启动。
- `close()` 停止接受新的日志操作，等待已接受的队列任务结束，并关闭 SSE 连接和服务；关闭后不能复用该实例。
- 文件尚不存在时网页显示“暂无日志”；无法解析的日志行按原文显示。
- 页面将日志作为文本渲染，不执行日志中的 HTML 或脚本。

## 网页操作

- 支持关键词搜索、日志详情展开与 JSON 格式化；搜索仅在提交后生效。
- “清空搜索”重置查询条件，“清空日志”删除日志内容，两者相互独立。
- “显示时间”默认勾选；取消后隐藏时间列，标题占用原时间列的宽度。该设置仅影响当前页面，刷新后恢复默认。
- “重新同步”重新读取日志文件，保留已提交的搜索条件。
- 网页仅查看日志，不提供写入入口。

## 停止与恢复录制

```ts
viewer.pause()
await viewer.log('暂停期间的日志直接丢弃')
viewer.resume()
await viewer.log('恢复后正常录制')
```

- `pause()` 同步将状态切换为 `pause`，之后的 `log()` 返回已完成的 `Promise<void>`，不执行过滤、序列化、文件写入或 SSE 推送，也不缓存待补录日志。
- 暂停前已经接受的写入仍完成；`resume()` 只恢复后续调用，不补录暂停期间的内容。重复暂停或恢复不会产生额外操作。
- 暂停不是关闭：`server()`、浏览历史日志、SSE 连接和网页清空仍可使用；最终退出仍需 `await viewer.close()`。
- 关闭中或关闭后的实例不能恢复，调用 `pause()` 或 `resume()` 会同步抛出错误。
- 网页提供“停止录制 / 继续录制”按钮，与代码侧接口控制同一个 `LogViewer` 实例，影响该实例的所有调用方和已打开页面，而不是只暂停当前页面显示。
- 页面显示独立的“录制中 / 已停止录制”状态；提交时禁用按钮，失败提示不影响历史日志、搜索或清空。停止/恢复不重新读取历史，也不收起详情。
- 录制状态在所有已打开页面之间同步；断线或未同步时控制按钮不可用，重新连接后恢复同步。

## 实时与清空

- 页面通过 SSE 实时追加新记录，无需手动刷新，也不收起已展开的详情。
- 实时事件仅来自同一个 `LogViewer` 实例的成功 `log()` 和网页清空操作。不监视其他进程或实例直接修改文件；“重新同步”可主动读取实际文件。
- 断线期间保留上次结果，自动重连后重新同步。同步失败提供重试，查询提交后重新同步该查询；输入中的草稿不影响实时筛选。
- “清空日志”与“清空搜索”不同：确认后清空当前整个文件，包括没有匹配搜索的内容，**不可恢复**。文件保留；文件不存在时不会创建文件或目录。
- 清空前已排队的写入被清除，清空后排队的写入保留；其他页面同步清空结果，分别保留搜索条件。
- 清空失败保留原记录并显示独立错误，可重试；清空请求已提交后不能通过取消对话框撤销服务端操作。
- 服务仅支持本机同源访问，不提供登录鉴权；拥有本机访问权的程序仍可操作日志。

## 日志格式

使用 UTF-8 的 JSON Lines 格式，每行一条 JSON 记录，文件扩展名为 `.log`：

```jsonl
{"timestamp":"2026-10-15T02:00:00.000Z","message":"服务启动成功"}
{"timestamp":"2026-10-15T02:00:01.000Z","title":"用户信息","message":{"id":123,"name":"Alice"}}
```

文件中保存 UTC 时间，网页转换为查看者的本地时间。多行字符串通过 JSON 转义保存，仍然是一条记录。

## 暂不包含

日志级别筛选、日志轮转、历史文件切换、自动清理、登录权限、远程访问、请求与响应配对、外部文件变化监视，以及多进程共享写入保障。

## 本地开发

开发、构建、测试和发布检查需 Node.js `^22.22.2 || ^24.15.0 || >=26.0.0`，即 22.x 至少 22.22.2、24.x 至少 24.15.0，或 26.0.0 及以上版本。该范围由当前 jsdom 测试工具链决定，也满足 tsdown 与 Vite 的要求。建议使用满足上述范围的 LTS 版本，并安装 pnpm；这与发布包的最低运行时版本不同。

```sh
pnpm install
pnpm test
pnpm run typecheck
pnpm run build
pnpm run test:types
```

`test:types` 检查构建产物的公开声明，应在 `build` 后运行。当前使用已有的 TypeScript 7 工具链，tsdown 构建时会提示其 API 为实验性。

## Web 开发

`web/` 使用 React / Tailwind CSS / Vite。`pnpm run build` 构建 Node 库和网页资源；生产使用只需调用 `viewer.server()`，不需要额外启动 Vite。

前端开发使用两个终端：

```sh
pnpm run dev:server
pnpm run dev:web
```

`dev:server` 启动本机 8899 端口并写入一条开发示例；`dev:web` 提供热更新，将 `/api` 代理到 `http://127.0.0.1:8899`。可通过 `LOG_VIEWER_API_URL` 环境变量修改开发代理目标，例如 PowerShell：

```powershell
$env:LOG_VIEWER_API_URL = 'http://127.0.0.1:9900'
pnpm run dev:web
```

该变量只用于开发配置，不改变生产监听地址。代理保留浏览器的 Host/Origin，不以开放 CORS 绕过清空保护。`pnpm run dev` 保留库的监听构建；单独 `build:lib` 和库监听不会清理已有 `dist/web/`。

`pnpm test` 和 `pnpm run typecheck` 分别覆盖 Node 和 Web。可用 `test:lib`、`test:web`、`typecheck:lib`、`typecheck:web` 单独验证；`test:types` 仍在完整构建后检查公开声明。Node 包无新增运行时依赖，React 随静态资源打包；发布包包含 `dist/`、README、项目许可证和第三方许可说明。
