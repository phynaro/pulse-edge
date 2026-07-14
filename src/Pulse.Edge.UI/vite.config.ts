/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 8080,
    proxy: {
      '/api': {
        // The edge API serves HTTPS by default (Slice 2B). `secure: false` accepts its
        // self-signed dev certificate. This proxies both regular /api fetches and the
        // /api/diagnostic-logs/stream Server-Sent Events connection.
        target: 'https://localhost:5288',
        changeOrigin: true,
        secure: false
      }
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: false,
  },
})
