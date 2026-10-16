import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    proxy: { '/api': { target: process.env.LOG_VIEWER_API_URL ?? 'http://127.0.0.1:8899', changeOrigin: false } },
  },
  build: { outDir: fileURLToPath(new URL('../dist/web/', import.meta.url)), emptyOutDir: true },
})
