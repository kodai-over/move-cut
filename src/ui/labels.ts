// 画面間で共有する表示用の定数・関数
import type { Mode } from '../analysis/types'

export const MODE_LABEL: Record<Mode, { title: string; note: string }> = {
  idea: { title: 'アイデア出し', note: '細かく分割' },
  run: { title: '通し練習', note: '前後のみトリム' },
}

/** 秒を m:ss 形式にする */
export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
