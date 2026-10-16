import { defineConfig } from 'tsdown'

export default defineConfig({
  clean: false,
  dts: {
    tsgo: true,
  },
  exports: false,
})
