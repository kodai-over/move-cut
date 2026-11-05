// 動きスコア算出（仕様書「ステップ1」）の純粋関数群
// ブラウザAPIに依存しないので、そのまま単体テスト・他言語への移植ができる

import { ANALYSIS } from '../config'
import type { Box, FrameObservation, MotionSample, Pose, ScoreSource } from './types'

/** MediaPipe Pose のランドマーク番号 */
export const LANDMARK = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const

/** 骨格スコアに使う関節（頭・肩・肘・手首・腰・膝・足首） */
export const SCORE_JOINTS: readonly number[] = Object.values(LANDMARK)

export interface MotionParams {
  sampleFps: number
  jointMinConfidence: number
  minReliableJoints: number
  smoothingWindowSec: number
  nearCameraFrameDiff: number
  nearCameraPoseHeight: number
  nearCameraMarginSec: number
}

const DEFAULT_PARAMS: MotionParams = ANALYSIS

/** 骨格の全関節を囲むボックス */
export function boundingBox(pose: Pose): Box {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const j of pose) {
    minX = Math.min(minX, j.x)
    minY = Math.min(minY, j.y)
    maxX = Math.max(maxX, j.x)
    maxY = Math.max(maxY, j.y)
  }
  return { minX, minY, maxX, maxY }
}

export function boxArea(b: Box): number {
  return Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY)
}

export function boxDiagonal(b: Box): number {
  return Math.hypot(b.maxX - b.minX, b.maxY - b.minY)
}

/** バウンディングボックスが最大の人物を本人とみなす。検出なしなら null */
export function selectMainPose(poses: readonly Pose[]): Pose | null {
  let best: Pose | null = null
  let bestArea = -1
  for (const p of poses) {
    if (p.length === 0) continue
    const area = boxArea(boundingBox(p))
    if (area > bestArea) {
      best = p
      bestArea = area
    }
  }
  return best
}

/**
 * 骨格スコア：信頼できる関節の前フレームからの移動量の平均を、体の大きさ（ボックス対角線）で割った値。
 * 体ごと移動した分（全関節の移動量の平均）は差し引き、手足など体の中での動きだけを数える。
 * 歩いて移動するだけの時間を「動き」と判定しないため
 * reliableJoints は前後両フレームで信頼度が下限以上だった関節の数
 */
export function skeletonScore(
  prev: Pose | null,
  cur: Pose | null,
  minConfidence: number = DEFAULT_PARAMS.jointMinConfidence,
): { score: number | null; reliableJoints: number } {
  if (!prev || !cur) return { score: null, reliableJoints: 0 }
  const moves: { dx: number; dy: number }[] = []
  for (const i of SCORE_JOINTS) {
    const a = prev[i]
    const b = cur[i]
    if (!a || !b) continue
    if (a.confidence < minConfidence || b.confidence < minConfidence) continue
    moves.push({ dx: b.x - a.x, dy: b.y - a.y })
  }
  const count = moves.length
  const diag = boxDiagonal(boundingBox(cur))
  if (count === 0 || diag <= 0) return { score: null, reliableJoints: count }
  // 体全体の移動（平均移動量）を差し引く
  const mx = moves.reduce((s, m) => s + m.dx, 0) / count
  const my = moves.reduce((s, m) => s + m.dy, 0) / count
  const sum = moves.reduce((s, m) => s + Math.hypot(m.dx - mx, m.dy - my), 0)
  return { score: sum / count / diag, reliableJoints: count }
}

/** 体幹の角度：肩の中点→腰の中点のベクトルと鉛直方向のなす角（0〜180度）。関節が不確かなら null */
export function trunkAngle(
  pose: Pose | null,
  minConfidence: number = DEFAULT_PARAMS.jointMinConfidence,
): number | null {
  if (!pose) return null
  const ids = [LANDMARK.leftShoulder, LANDMARK.rightShoulder, LANDMARK.leftHip, LANDMARK.rightHip]
  const [ls, rs, lh, rh] = ids.map((i) => pose[i])
  if ([ls, rs, lh, rh].some((j) => !j || j.confidence < minConfidence)) return null
  const dx = (lh.x + rh.x) / 2 - (ls.x + rs.x) / 2
  const dy = (lh.y + rh.y) / 2 - (ls.y + rs.y) / 2
  if (dx === 0 && dy === 0) return null
  // 画像座標は下向きが +y。直立（肩が上・腰が下）で 0度、逆立ちで 180度
  return (Math.atan2(Math.abs(dx), dy) * 180) / Math.PI
}

/** RGBA 画素列をグレースケールに変換する（ITU-R BT.601 の輝度係数） */
export function toGrayscale(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const n = rgba.length / 4
  const gray = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const o = i * 4
    gray[i] = (rgba[o] * 299 + rgba[o + 1] * 587 + rgba[o + 2] * 114) / 1000
  }
  return gray
}

/** ボックスを各辺 margin（幅・高さ比）だけ広げ、画像範囲に収める */
export function expandBox(b: Box, margin: number, width: number, height: number): Box {
  const mx = (b.maxX - b.minX) * margin
  const my = (b.maxY - b.minY) * margin
  return {
    minX: Math.max(0, b.minX - mx),
    minY: Math.max(0, b.minY - my),
    maxX: Math.min(width, b.maxX + mx),
    maxY: Math.min(height, b.maxY + my),
  }
}

/**
 * 差分スコア：グレースケール画素差が threshold 以上の画素の割合（0〜1）
 * roi を指定するとその範囲内だけで数える。範囲が空なら画像全体で数える
 */
export function diffRatio(
  prev: Uint8Array,
  cur: Uint8Array,
  width: number,
  height: number,
  threshold: number,
  roi: Box | null = null,
): number {
  let x0 = 0
  let y0 = 0
  let x1 = width
  let y1 = height
  if (roi) {
    const rx0 = Math.max(0, Math.floor(roi.minX))
    const ry0 = Math.max(0, Math.floor(roi.minY))
    const rx1 = Math.min(width, Math.ceil(roi.maxX))
    const ry1 = Math.min(height, Math.ceil(roi.maxY))
    if (rx1 > rx0 && ry1 > ry0) {
      x0 = rx0
      y0 = ry0
      x1 = rx1
      y1 = ry1
    }
  }
  let changed = 0
  for (let y = y0; y < y1; y++) {
    const row = y * width
    for (let x = x0; x < x1; x++) {
      if (Math.abs(cur[row + x] - prev[row + x]) >= threshold) changed++
    }
  }
  const total = (x1 - x0) * (y1 - y0)
  return total > 0 ? changed / total : 0
}

/** 中心化した移動平均（窓幅 window フレーム。偶数は奇数に切り下げる。端は窓を縮める） */
export function movingAverage(values: readonly number[], window: number): number[] {
  const half = Math.floor((Math.max(1, window) - 1) / 2)
  const out: number[] = new Array(values.length)
  for (let i = 0; i < values.length; i++) {
    const from = Math.max(0, i - half)
    const to = Math.min(values.length - 1, i + half)
    let sum = 0
    for (let k = from; k <= to; k++) sum += values[k]
    out[i] = sum / (to - from + 1)
  }
  return out
}

/**
 * 1フレームがカメラ付近か。画面全体の差分が閾値以上で、かつ本人の骨格が取れていないか、体が画面の大部分を占めるとき。
 * 骨格が取れていて体が小さい（離れている）ときは、画面全体の変化はカメラの揺れや照明によるものとみなす
 */
export function isNearCameraFrame(
  frameDiff: number | null,
  skeletonReliable: boolean,
  poseHeightRatio: number | null,
  params: Pick<MotionParams, 'nearCameraFrameDiff' | 'nearCameraPoseHeight'>,
): boolean {
  if (frameDiff === null || frameDiff < params.nearCameraFrameDiff) return false
  if (!skeletonReliable) return true
  return poseHeightRatio !== null && poseHeightRatio >= params.nearCameraPoseHeight
}

/** 該当フレーム（hit）と、その前後 marginSec 秒を true にする */
export function expandMask(times: readonly number[], hit: readonly boolean[], marginSec: number): boolean[] {
  const eps = 1e-9
  const mask = new Array<boolean>(times.length).fill(false)
  // 前から：直近の該当フレームから marginSec 以内
  let last = -Infinity
  for (let i = 0; i < times.length; i++) {
    if (hit[i]) last = times[i]
    if (times[i] - last <= marginSec + eps) mask[i] = true
  }
  // 後ろから：次の該当フレームまで marginSec 以内
  let next = Infinity
  for (let i = times.length - 1; i >= 0; i--) {
    if (hit[i]) next = times[i]
    if (next - times[i] <= marginSec + eps) mask[i] = true
  }
  return mask
}

/**
 * フレームごとの観測値から、動きスコアの時系列を作る。
 * 次のフレームは動きとして数えない（スコア0）：
 * - カメラ付近にいる時間（撮影ボタンを押しに行く・カメラの前を通る）
 * - 本人の骨格を最初に検出する前・最後に検出した後（体の一部しか写らず差分スコアだけが跳ね上がるため）。
 *   ただし動画全体で一度も骨格を検出できなかった場合は、差分スコアだけで判定する
 */
export function buildMotionSeries(
  frames: readonly FrameObservation[],
  params: MotionParams = DEFAULT_PARAMS,
): MotionSample[] {
  const raw: number[] = []
  const rows: Omit<MotionSample, 'score'>[] = []
  const nearHit: boolean[] = []
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    // 別人どうしの位置の差を動きと誤認しないよう、追跡が続いているときだけ骨格スコアを計算する
    const prev = i > 0 && f.continuous ? frames[i - 1].mainPose : null
    const sk = skeletonScore(prev, f.mainPose, params.jointMinConfidence)
    let source: ScoreSource
    let value: number
    if (sk.score !== null && sk.reliableJoints >= params.minReliableJoints) {
      source = 'skeleton'
      value = sk.score
    } else if (f.diffScore !== null) {
      source = 'diff'
      value = f.diffScore
    } else {
      source = 'none'
      value = 0
    }
    const box = f.mainPose ? boundingBox(f.mainPose) : null
    const heightRatio = box && f.frameHeight > 0 ? (box.maxY - box.minY) / f.frameHeight : null
    nearHit.push(isNearCameraFrame(f.frameDiff, source === 'skeleton', heightRatio, params))
    raw.push(value)
    rows.push({
      time: f.time,
      skeletonScore: sk.score,
      diffScore: f.diffScore,
      frameDiff: f.frameDiff,
      source,
      trunkAngle: trunkAngle(f.mainPose, params.jointMinConfidence),
      poseCount: f.poseCount,
    })
  }
  const near = expandMask(
    rows.map((r) => r.time),
    nearHit,
    params.nearCameraMarginSec,
  )
  near.forEach((isNear, i) => {
    if (!isNear) return
    rows[i].source = 'nearCamera'
    raw[i] = 0
  })
  // 骨格を最初に検出する前・最後に検出した後は数えない（カメラ付近の判定を優先して残す）
  const first = rows.findIndex((r) => r.source === 'skeleton')
  if (first >= 0) {
    // findLastIndex は古いiOS Safariにないため後ろから探す
    let last = rows.length - 1
    while (rows[last].source !== 'skeleton') last--
    rows.forEach((r, i) => {
      if ((i < first || i > last) && r.source !== 'nearCamera') {
        r.source = 'outside'
        raw[i] = 0
      }
    })
  }
  const windowFrames = Math.round(params.smoothingWindowSec * params.sampleFps)
  const smoothed = movingAverage(raw, windowFrames)
  return rows.map((r, i) => ({ ...r, score: smoothed[i] }))
}

const SOURCE_LABEL: Record<ScoreSource, string> = {
  skeleton: '骨格',
  diff: '差分',
  none: 'なし',
  nearCamera: 'カメラ付近',
  outside: '本人検出前後',
}

/** 動きスコアをCSV文字列にする（先頭にBOMを付けてExcelでも文字化けしないようにする） */
export function toCsv(samples: readonly MotionSample[]): string {
  const fmt = (v: number | null, digits: number) => (v === null ? '' : v.toFixed(digits))
  const header = '時刻(秒),骨格スコア,差分スコア,画面全体の差分,統合スコア(平滑化後),採用スコア,体幹角度(度),検出人数'
  const lines = samples.map((s) =>
    [
      fmt(s.time, 2),
      fmt(s.skeletonScore, 5),
      fmt(s.diffScore, 5),
      fmt(s.frameDiff, 5),
      fmt(s.score, 5),
      SOURCE_LABEL[s.source],
      fmt(s.trunkAngle, 1),
      String(s.poseCount),
    ].join(','),
  )
  return '﻿' + [header, ...lines].join('\n') + '\n'
}
