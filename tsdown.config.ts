import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'
import { embeddedWebAssetsPlugin } from './scripts/embed-web-assets.ts'

export default defineConfig({
  clean: false,
  dts: {
    tsgo: true,
  },
  exports: false,
  plugins: [embeddedWebAssetsPlugin(
    fileURLToPath(new URL('./src/web-assets.ts', import.meta.url)),
    fileURLToPath(new URL('./dist/web/', import.meta.url)),
  )],
})
