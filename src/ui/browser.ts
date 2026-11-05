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
  downloadBlob(new Blob([text], { type }), filename)
}

/** Blob をファイルとしてダウンロードさせる */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
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

/** 共有シートでファイルを渡せるか（iPhoneのSafariなど） */
export function canShareFiles(files: File[]): boolean {
  return typeof navigator.canShare === 'function' && navigator.canShare({ files })
}

/**
 * 動画を保存する。共有シートが使えれば共有シート（「ビデオを保存」で写真アプリへ）、使えなければダウンロード。
 * 共有シートはタップ直後にしか開けないため、ボタンのクリック処理から直接呼ぶ。
 * 共有シートをキャンセルした場合は 'cancelled' を返す
 */
export async function saveFiles(files: File[]): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (canShareFiles(files)) {
    try {
      await navigator.share({ files })
      return 'shared'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
      throw e
    }
  }
  for (const f of files) downloadBlob(f, f.name)
  return 'downloaded'
}
