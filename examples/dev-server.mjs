import { LogViewer } from '../dist/index.mjs'

const viewer = new LogViewer({ port: 8899 })
try {
  await viewer.log({ title: '开发示例', message: { name: 'Alice', ready: true } })
  console.log(await viewer.server())
  // setInterval(() => {
  //   viewer.log({ title: '开发示例', message: { name: 'Alice', ready: true } })
  // }, 3000);
} catch (error) {
  await viewer.close()
  throw error
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    viewer.close().then(() => process.exit(0), (error) => {
      console.error(error)
      process.exit(1)
    })
  })
}
