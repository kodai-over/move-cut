/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages（https://<user>.github.io/move-cut/）で配信するためのベースパス
export default defineConfig({
  base: '/move-cut/',
  plugins: [react()],
  server: {
    // 同一Wi-FiのiPhoneから開発サーバーにアクセスできるようにする
    host: true,
  },
  test: {
    passWithNoTests: true,
  },
})
