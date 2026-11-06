// 編集中のクリップ（AIの提案を土台に、手で伸縮・残す/捨てるを変えたもの）を扱う。UI・ブラウザAPIに依存しない
import type { Interval } from '../analysis/segment'
import { nearestKeyframe, snapToKeyframe } from '../export/keyframes'

export interface EditClip extends Interval {
  /** 伸縮・合体しても同じクリップを見分けるための番号 */
  id: number
  keep: boolean
}

export type ClipEdge = 'start' | 'end'

export interface TrimLimits {
  duration: number
  /** クリップの最短の長さ（秒） */
  minSec: number
  /** キーフレームの時刻（読めていなければ null。開始位置を吸着させない） */
  keyframes: readonly number[] | null
}

/** AIの提案した区間から、編集用のクリップを作る（すべて「残す」） */
export function clipsFromIntervals(intervals: readonly Interval[]): EditClip[] {
  return intervals.map((it, i) => ({ id: i, start: it.start, end: it.end, keep: true }))
}

/**
 * 重なったクリップを1つにまとめる（開始順に並べ直す）。
 * まとめたクリップは、どちらかが「残す」なら残す。番号は keepId のクリップがあればそれを、なければ先のものを使う
 */
export function mergeOverlaps(clips: readonly EditClip[], keepId?: number): EditClip[] {
  const sorted = [...clips].sort((a, b) => a.start - b.start)
  const out: EditClip[] = []
  for (const c of sorted) {
    const last = out[out.length - 1]
    if (last && c.start < last.end) {
      out[out.length - 1] = {
        id: c.id === keepId ? c.id : last.id,
        start: last.start,
        end: Math.max(last.end, c.end),
        keep: last.keep || c.keep,
      }
    } else {
      out.push({ ...c })
    }
  }
  return out
}

/**
 * クリップの端を time へ動かす。開始位置はキーフレームに吸着させる（再エンコードしない切り出しは開始をキーフレームにしか置けないため）。
 * 動画の範囲と最短の長さに収め、他のクリップと重なったら合体する。対象が見つからなければそのまま返す
 */
export function trimClip(
  clips: readonly EditClip[],
  id: number,
  edge: ClipEdge,
  time: number,
  limits: TrimLimits,
): EditClip[] {
  const target = clips.find((c) => c.id === id)
  if (!target) return [...clips]
  const { duration, minSec, keyframes } = limits
  let { start, end } = target
  if (edge === 'start') {
    const latest = Math.max(0, end - minSec)
    start = Math.min(Math.max(0, time), latest)
    if (keyframes && keyframes.length > 0) {
      start = nearestKeyframe(start, keyframes)
      // 吸着した結果が短すぎるときは、手前のキーフレームにする
      if (start > latest) start = snapToKeyframe(latest, keyframes)
    }
  } else {
    end = Math.max(Math.min(duration, time), Math.min(duration, start + minSec))
  }
  const moved = clips.map((c) => (c.id === id ? { ...c, start, end } : c))
  return mergeOverlaps(moved, id)
}

/**
 * クリップを time で2つに分ける（カットツール）。分けた後ろのクリップの開始はキーフレームでなければならないので、
 * 切る位置は最も近いキーフレームに吸着させる。どちらかが最短の長さに満たなければ分けない（null を返す）。
 * 後ろのクリップには新しい番号を付け、残す／捨てるは元のクリップを引き継ぐ
 */
export function splitClip(
  clips: readonly EditClip[],
  id: number,
  time: number,
  limits: TrimLimits,
): EditClip[] | null {
  const target = clips.find((c) => c.id === id)
  if (!target) return null
  const cut = limits.keyframes && limits.keyframes.length > 0 ? nearestKeyframe(time, limits.keyframes) : time
  if (cut - target.start < limits.minSec || target.end - cut < limits.minSec) return null
  const nextId = Math.max(...clips.map((c) => c.id)) + 1
  return clips.flatMap((c) =>
    c.id === id ? [{ ...c, end: cut }, { id: nextId, start: cut, end: c.end, keep: c.keep }] : [c],
  )
}
