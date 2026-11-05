// 区間の切り出し（ステップ2）。動きスコアの時系列から、動いている区間とフリーズを求める
import { SEGMENT, type SegmentParams } from '../config'
import type { Mode, MotionSample } from './types'

/** 時間区間（秒） */
export interface Interval {
  start: number
  end: number
}

export type FreezeParams = { [K in keyof typeof SEGMENT]: number }

export interface SegmentResult {
  /** 余白・結合・最小長を適用した切り出し区間 */
  clips: Interval[]
  /** フリーズと判定して区間に含めた静止 */
  freezes: Interval[]
}

/** サンプル間隔（秒）。2点未満なら0 */
function sampleInterval(samples: MotionSample[]): number {
  return samples.length >= 2 ? samples[1].time - samples[0].time : 0
}

/** endIndex の直前 lookbackSec 秒（endIndex 自身は含まない）のスコアの最大値 */
function peakScore(samples: MotionSample[], endIndex: number, lookbackSec: number): number {
  const from = samples[endIndex].time - lookbackSec
  let peak = 0
  for (let i = endIndex - 1; i >= 0 && samples[i].time >= from - 1e-9; i--) {
    peak = Math.max(peak, samples[i].score)
  }
  return peak
}

function isTilted(sample: MotionSample, minDeg: number): boolean {
  return sample.trunkAngle != null && sample.trunkAngle >= minDeg
}

/**
 * 動き開始・終了とフリーズを判定する（余白などを付ける前の区間）。
 * - 開始閾値を上回る状態が startHoldSec 続いたら、その最初の時刻を開始とする
 * - 終了閾値を下回る状態が stillSec 続いたら、下回った最初の時刻を終了とする
 * - 静止の始まりで、直前の動きが大きく体幹が傾いていれば、その静止をフリーズとして動きに含める（最大 freezeMaxSec）。
 *   フリーズが終わった後の静止は、通常どおり区切り静止秒数を数える
 */
export function detectMotion(
  samples: MotionSample[],
  params: Pick<SegmentParams, 'startThreshold' | 'endThreshold' | 'stillSec'>,
  fp: FreezeParams = SEGMENT,
): { motions: Interval[]; freezes: Interval[] } {
  const motions: Interval[] = []
  const freezes: Interval[] = []
  const dt = sampleInterval(samples)
  const eps = 1e-9

  let moving = false
  let motionStart = 0
  /** 停止中：開始閾値を上回り続けている最初の時刻 */
  let aboveSince: number | null = null
  /** 動き中：終了閾値を下回り続けている最初の時刻（フリーズ中は数えない） */
  let lowSince: number | null = null
  /** 動き中：フリーズの開始時刻 */
  let freezeSince: number | null = null

  const closeFreeze = (end: number) => {
    if (freezeSince == null) return
    freezes.push({ start: freezeSince, end })
    freezeSince = null
  }

  samples.forEach((s, i) => {
    const t = s.time
    if (!moving) {
      if (s.score > params.startThreshold) {
        aboveSince ??= t
        if (t - aboveSince + dt >= fp.startHoldSec - eps) {
          moving = true
          motionStart = aboveSince
          lowSince = null
        }
      } else {
        aboveSince = null
      }
      return
    }

    if (s.score >= params.endThreshold) {
      closeFreeze(t)
      lowSince = null
      return
    }

    if (freezeSince != null) {
      const withinMax = t - freezeSince + dt <= fp.freezeMaxSec + eps
      if (withinMax && isTilted(s, fp.freezeMinTrunkDeg)) return
      // 体幹が起きた・最大秒数を超えたらフリーズ終了。ここからは通常の静止として数える
      closeFreeze(t)
      lowSince = t
    } else if (lowSince == null) {
      const isFreeze =
        isTilted(s, fp.freezeMinTrunkDeg) &&
        peakScore(samples, i, fp.freezeLookbackSec) >= params.startThreshold * fp.freezePeakRatio
      if (isFreeze) {
        freezeSince = t
        return
      }
      lowSince = t
    }

    if (lowSince != null && t - lowSince + dt >= params.stillSec - eps) {
      motions.push({ start: motionStart, end: lowSince })
      moving = false
      aboveSince = null
      lowSince = null
    }
  })

  if (moving && samples.length) {
    const last = samples[samples.length - 1].time
    closeFreeze(last)
    motions.push({ start: motionStart, end: lowSince ?? last })
  }
  return { motions, freezes }
}

/** 余白を付け、近い区間をまとめ、短い区間を捨てる。通し練習モードは最初〜最後を1区間にする */
export function buildClips(motions: Interval[], duration: number, params: SegmentParams, mode: Mode): Interval[] {
  const merged: Interval[] = []
  for (const m of motions) {
    const clip = {
      start: Math.max(0, m.start - params.marginBeforeSec),
      end: Math.min(duration, m.end + params.marginAfterSec),
    }
    const last = merged[merged.length - 1]
    if (last && clip.start - last.end < params.mergeSec) {
      last.end = Math.max(last.end, clip.end)
    } else {
      merged.push(clip)
    }
  }
  const kept = merged.filter((c) => c.end - c.start >= params.minClipSec - 1e-9)
  if (mode === 'run' && kept.length > 0) {
    return [{ start: kept[0].start, end: kept[kept.length - 1].end }]
  }
  return kept
}

/** 動きスコアの時系列から切り出し区間を求める（パラメータ変更時はこれだけをやり直す） */
export function segmentMotion(
  samples: MotionSample[],
  params: SegmentParams,
  mode: Mode,
  fp: FreezeParams = SEGMENT,
): SegmentResult {
  const duration = samples.length ? samples[samples.length - 1].time : 0
  const { motions, freezes } = detectMotion(samples, params, fp)
  const clips = buildClips(motions, duration, params, mode)
  // 捨てた区間のフリーズは表示しない
  const kept = freezes.filter((f) => clips.some((c) => f.start < c.end && f.end > c.start))
  return { clips, freezes: kept }
}
