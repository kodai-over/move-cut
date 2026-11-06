// 画面間で共有する表示用の関数

/** 秒を m:ss 形式にする */
export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
