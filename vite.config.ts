/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages（https://<user>.github.io/move-cut/）で配信するためのベースパス
export default defineConfig({
  base: '/move-cut/',
  plugins: [react()],
  // ffmpeg.wasm はパッケージ内の worker.js を new URL(..., import.meta.url) で読むため、事前バンドルから外す
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg'],
  },
  // ffmpeg.wasm のワーカーは ES モジュール（import を含む）
  worker: {
    format: 'es',
  },
  server: {
    // 同一Wi-FiのiPhoneから開発サーバーにアクセスできるようにする
    host: true,
  },
  test: {
    passWithNoTests: true,
  },
})
