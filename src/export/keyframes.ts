// キーフレーム（単独で表示できるコマ）の時刻を扱う。UI・ブラウザAPIに依存しない
// 再エンコードしない切り出しは開始位置をキーフレームにしか置けないため、開始のつまみを吸着させるのに使う

/**
 * ffprobe の `-show_entries packet=pts_time,flags -of csv=p=0` の出力から、キーフレームの時刻（秒、昇順・重複なし）を取り出す。
 * 各行は `<pts_time>,<flags>`（flags に K が含まれればキーフレーム）
 */
export function parseKeyframeTimes(csv: string): number[] {
  const times = new Set<number>()
  for (const line of csv.split(/\r?\n/)) {
    const [pts, flags] = line.split(',')
    if (!flags?.includes('K')) continue
    const t = Number(pts)
    if (Number.isFinite(t)) times.add(Math.max(0, t))
  }
  return [...times].sort((a, b) => a - b)
}

/** time 以下で最も近いキーフレームの時刻。キーフレームがなければ time をそのまま返す */
export function snapToKeyframe(time: number, keyframes: readonly number[]): number {
  let best: number | null = null
  for (const k of keyframes) {
    if (k <= time + 1e-6) best = k
    else break
  }
  return best ?? time
}

/** time に最も近いキーフレームの時刻（前後どちらでも）。キーフレームがなければ time をそのまま返す */
export function nearestKeyframe(time: number, keyframes: readonly number[]): number {
  let best = time
  let bestDist = Infinity
  for (const k of keyframes) {
    const d = Math.abs(k - time)
    if (d < bestDist) {
      best = k
      bestDist = d
    }
  }
  return best
}
