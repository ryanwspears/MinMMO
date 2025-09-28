import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const r = (p: string) => resolve(fileURLToPath(new URL('.', import.meta.url)), p)

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@app': r('src/app'),
      '@config': r('src/config'),
      '@content': r('src/content'),
      '@engine': r('src/engine'),
      '@game': r('src/game'),
      '@cms': r('src/cms'),
      '@game-config': r('packages/game-config/src'),
    }
  },
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://localhost:3001',
        changeOrigin: true,
      }
    }
  },
  build: {
    rollupOptions: {
      input: {
        index: r('index.html'),
        admin: r('admin.html'),
      }
    }
  }
})