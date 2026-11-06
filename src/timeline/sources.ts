// 複数の動画を1本のタイムラインにつなげて扱う。UI・ブラウザAPIに依存しない
// 「全体の時刻」は1本目の先頭を0として動画を順につなげた時刻、「動画内の時刻」は各動画の先頭を0とした時刻
import type { Interval } from '../analysis/segment'

/** 各動画の先頭の全体の時刻（累積和）。末尾に全体の長さを付けない */
export function sourceOffsets(durations: readonly number[]): number[] {
  const offsets: number[] = []
  let sum = 0
  for (const d of durations) {
    offsets.push(sum)
    sum += d
  }
  return offsets
}

/** 全体の時刻が、何本目の動画のどの時刻にあたるか（範囲外は先頭・末尾の動画に収める） */
export function locate(
  time: number,
  offsets: readonly number[],
  durations: readonly number[],
): { index: number; local: number } {
  if (offsets.length === 0) return { index: 0, local: 0 }
  let index = 0
  for (let i = 0; i < offsets.length; i++) {
    if (time >= offsets[i]) index = i
    else break
  }
  const local = Math.min(Math.max(0, time - offsets[index]), durations[index])
  return { index, local }
}

/** 区間を全体の時刻にずらす */
export function shiftIntervals<T extends Interval>(list: readonly T[], offset: number): T[] {
  return list.map((it) => ({ ...it, start: it.start + offset, end: it.end + offset }))
}

/** 時刻を全体の時刻にずらす */
export function shiftTimes<T extends { time: number }>(list: readonly T[], offset: number): T[] {
  return list.map((it) => ({ ...it, time: it.time + offset }))
}

/** 編集用クリップの番号を、動画ごとに重ならないようにする倍率（1本の動画のクリップはこれより少ない） */
const ID_STRIDE = 1_000_000

/** 動画の番号と動画内のクリップ番号から、全体で重ならない番号を作る */
export function globalClipId(source: number, localId: number): number {
  return source * ID_STRIDE + localId
}

/** 全体の番号を、動画の番号と動画内のクリップ番号に戻す */
export function splitClipId(id: number): { source: number; localId: number } {
  return { source: Math.floor(id / ID_STRIDE), localId: id % ID_STRIDE }
}

/** 撮った順に並べる：ファイル名を数字の大小も考えて並べる（iPhoneは IMG_1234 のように連番になる） */
export function compareFileNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}
