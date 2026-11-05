// タイムラインの座標計算と描画用データの間引き。UI・ブラウザAPIに依存しない

/** 時刻（秒）→ タイムライン上のx座標（px） */
export function timeToX(time: number, pxPerSec: number): number {
  return time * pxPerSec
}

/** タイムライン上のx座標（px）→ 時刻（秒）。0〜duration に収める */
export function xToTime(x: number, pxPerSec: number, duration: number): number {
  if (pxPerSec <= 0) return 0
  return Math.min(duration, Math.max(0, x / pxPerSec))
}

/** 拡大率を [全体が幅に収まる値, 上限] に収める */
export function clampZoom(pxPerSec: number, fitPxPerSec: number, maxPxPerSec: number): number {
  return Math.min(Math.max(pxPerSec, fitPxPerSec), Math.max(fitPxPerSec, maxPxPerSec))
}

/** 全体が幅に収まる拡大率 */
export function fitZoom(viewWidth: number, duration: number): number {
  return duration > 0 && viewWidth > 0 ? viewWidth / duration : 1
}

/**
 * 拡大・縮小したとき、基準の時刻（再生位置など）が画面上の同じ位置に残るスクロール量を求める。
 * anchorTime は基準の時刻、anchorX は表示領域の中でのその位置（px）
 */
export function scrollForAnchor(anchorTime: number, anchorX: number, pxPerSec: number): number {
  return Math.max(0, anchorTime * pxPerSec - anchorX)
}

/**
 * 見えている範囲 [fromX, fromX + width) の波形を1pxごとに間引く（各列の最大値）。
 * times は昇順。値のない列は null
 */
export function waveformColumns(
  times: readonly number[],
  values: readonly number[],
  pxPerSec: number,
  fromX: number,
  width: number,
): (number | null)[] {
  const cols: (number | null)[] = new Array(Math.max(0, Math.ceil(width))).fill(null)
  if (pxPerSec <= 0) return cols
  // 見えている範囲の最初のサンプルを二分探索で探す
  const startTime = fromX / pxPerSec
  let lo = 0
  let hi = times.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (times[mid] < startTime) lo = mid + 1
    else hi = mid
  }
  for (let i = Math.max(0, lo - 1); i < times.length; i++) {
    const col = Math.floor(times[i] * pxPerSec - fromX)
    if (col >= cols.length) break
    if (col < 0) continue
    const prev = cols[col]
    cols[col] = prev === null ? values[i] : Math.max(prev, values[i])
  }
  return cols
}
