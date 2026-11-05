/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/** Service Worker でキャッシュする1ファイルの上限。ffmpeg.wasm のコア（約31MB）も入るようにする */
const MAX_CACHE_FILE_BYTES = 40 * 1024 * 1024

// GitHub Pages（https://<user>.github.io/move-cut/）で配信するためのベースパス
export default defineConfig({
  base: '/move-cut/',
  plugins: [
    react(),
    // PWA：ホーム画面から起動でき、初回表示以降は電波がなくても解析・書き出しまで使えるよう、
    // アプリ本体・骨格推定モデル・MediaPipe と ffmpeg.wasm をすべて事前キャッシュする
    VitePWA({
      // 解析・書き出しの途中で勝手に再読み込みしないよう、更新はユーザーが選ぶ
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'MoveCut',
        short_name: 'MoveCut',
        description: 'ブレイキングの練習動画から動いている区間だけを切り出す',
        lang: 'ja',
        start_url: '/move-cut/',
        scope: '/move-cut/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#2f7cf6',
        background_color: '#f6f5f2',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,wasm,task}'],
        maximumFileSizeToCacheInBytes: MAX_CACHE_FILE_BYTES,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
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
