// まとめて書き出すクリップを、メモリに収まる単位（バッチ）に分ける。UI・ブラウザAPIに依存しない
import type { Interval } from '../analysis/segment'

/** 書き出すクリップ（number は一覧での連番、1始まり。ファイル名に使う） */
export interface NumberedClip {
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
  sourceBytes: number,
  sourceDuration: number,
  maxBytes: number,
): NumberedClip[][] {
  const batches: NumberedClip[][] = []
  let current: NumberedClip[] = []
  let currentBytes = 0
  for (const c of clips) {
    const bytes = estimateClipBytes(c.clip, sourceBytes, sourceDuration)
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
