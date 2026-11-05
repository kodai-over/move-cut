// まとめて書き出すクリップを、メモリに収まる単位（バッチ）に分ける。UI・ブラウザAPIに依存しない
import type { Interval } from '../analysis/segment'

/** 書き出すクリップ（source は何本目の動画か。number はその動画の中での連番、1始まり。ファイル名に使う。clip は動画内の時刻） */
export interface NumberedClip {
  source: number
  number: number
  clip: Interval
}

/** 元動画のサイズと長さから、コピーで切り出したクリップのサイズを推定する（ビットレート一定とみなす） */
export function estimateClipBytes(clip: Interval, sourceBytes: number, sourceDuration: number): number {
  if (sourceDuration <= 0) return 0
  return (sourceBytes / sourceDuration) * Math.max(0, clip.end - clip.start)
}

/**
 * 推定サイズの合計が maxBytes 以下になるよう、順番を保ったままクリップを分ける。
 * 1本で maxBytes を超えるクリップは単独のバッチにする
 */
export function planBatches(
  clips: readonly NumberedClip[],
  /** クリップの推定サイズ（バイト）。元動画ごとにビットレートが違うので呼び出し側で計算する */
  estimate: (clip: NumberedClip) => number,
  maxBytes: number,
): NumberedClip[][] {
  const batches: NumberedClip[][] = []
  let current: NumberedClip[] = []
  let currentBytes = 0
  for (const c of clips) {
    const bytes = estimate(c)
    if (current.length > 0 && currentBytes + bytes > maxBytes) {
      batches.push(current)
      current = []
      currentBytes = 0
    }
    current.push(c)
    currentBytes += bytes
  }
  if (current.length > 0) batches.push(current)
  return batches
}
