// ブラウザ機能の小さなヘルパー
import { DOWNLOAD_URL_REVOKE_DELAY_MS } from '../config'

/**
 * 画面のスリープを防ぐ（非対応・失敗時は何もしない）。解除用の関数を返す
 * Wake Lock はページが非表示になると自動で外れるため、表示に戻ったら取り直す
 */
export async function keepScreenAwake(): Promise<() => void> {
  let lock: WakeLockSentinel | null = null
  let active = true
  const acquire = async () => {
    try {
      lock = (await navigator.wakeLock?.request('screen')) ?? null
    } catch {
      lock = null
    }
  }
  const onVisible = () => {
    if (active && document.visibilityState === 'visible') void acquire()
  }
  await acquire()
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    active = false
    document.removeEventListener('visibilitychange', onVisible)
    void lock?.release().catch(() => {})
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
