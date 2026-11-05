// ブラウザ機能の小さなヘルパー
import { DOWNLOAD_URL_REVOKE_DELAY_MS } from '../config'

/** 画面のスリープを防ぐ（非対応・失敗時は何もしない）。解除用の関数を返す */
export async function keepScreenAwake(): Promise<() => void> {
  try {
    const lock = await navigator.wakeLock?.request('screen')
    return () => {
      void lock?.release().catch(() => {})
    }
  } catch {
    return () => {}
  }
}

/** テキストをファイルとしてダウンロードさせる */
export function downloadText(text: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_REVOKE_DELAY_MS)
}

/** 拡張子を除いたファイル名 */
export function baseName(filename: string): string {
  const i = filename.lastIndexOf('.')
  return i > 0 ? filename.slice(0, i) : filename
}
