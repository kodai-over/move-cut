// 本人追跡の純粋関数
// 毎フレーム「最大の人物」を選ぶと、近くの他人に本人判定が移ってスコアが跳ねるため、
// 前フレームの本人に最も近い人物を追い続け、見失った状態が続いたら最大の人物を選び直す
// （選び直すのは、最後に見た本人と同程度以上の大きさに写っている人物に限る）

import { ANALYSIS } from '../config'
import { boundingBox, boxDiagonal, selectMainPose } from './motion'
import type { Box, Pose } from './types'

export interface TrackParams {
  trackMaxCenterShift: number
  trackLostResetSec: number
  trackReacquireMinSizeRatio: number
  trackReacquireRefMaxRatio: number
}

export interface TrackState {
  /** 最後に本人と判定した骨格（見失い中もしばらく保持する） */
  last: Pose | null
  /** last を観測した時刻（秒） */
  lastTime: number
  /** 直前のフレームで本人を観測できていたか */
  seenPrevFrame: boolean
}

export interface TrackResult {
  /** このフレームの本人（見失った場合は null） */
  mainPose: Pose | null
  /** 直前フレームの本人と同一人物として追跡できたか（骨格スコアを計算してよいか） */
  continuous: boolean
  state: TrackState
}

export const INITIAL_TRACK_STATE: TrackState = { last: null, lastTime: -Infinity, seenPrevFrame: false }

function center(b: Box): { x: number; y: number } {
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
}

/** ref に最も近い人物を返す。中心の移動量が上限を超える人物しかいなければ null */
export function findNearestPose(poses: readonly Pose[], ref: Pose, maxCenterShift: number): Pose | null {
  const refBox = boundingBox(ref)
  const refCenter = center(refBox)
  const limit = boxDiagonal(refBox) * maxCenterShift
  let best: Pose | null = null
  let bestDist = Infinity
  for (const p of poses) {
    if (p.length === 0) continue
    const c = center(boundingBox(p))
    const d = Math.hypot(c.x - refCenter.x, c.y - refCenter.y)
    if (d <= limit && d < bestDist) {
      best = p
      bestDist = d
    }
  }
  return best
}

/**
 * 1フレーム分の本人追跡
 * frameDiagonal は解析画像の対角線（px）。選び直しの大きさ基準の上限に使う
 */
export function trackMainPose(
  poses: readonly Pose[],
  state: TrackState,
  time: number,
  frameDiagonal: number,
  params: TrackParams = ANALYSIS,
): TrackResult {
  const lostTooLong = time - state.lastTime > params.trackLostResetSec
  if (state.last && !lostTooLong) {
    const match = findNearestPose(poses, state.last, params.trackMaxCenterShift)
    if (match) {
      return {
        mainPose: match,
        continuous: state.seenPrevFrame,
        state: { last: match, lastTime: time, seenPrevFrame: true },
      }
    }
    // 見失い中：最後の位置を保持したまま待つ（別人に乗り換えない）
    return { mainPose: null, continuous: false, state: { ...state, seenPrevFrame: false } }
  }
  // 初回、または見失いが続いた：最大の人物を本人として選び直す
  const refDiag = state.last
    ? Math.min(boxDiagonal(boundingBox(state.last)), frameDiagonal * params.trackReacquireRefMaxRatio)
    : 0
  const minDiag = refDiag * params.trackReacquireMinSizeRatio
  const picked = selectMainPose(poses.filter((p) => p.length > 0 && boxDiagonal(boundingBox(p)) >= minDiag))
  if (!picked) return { mainPose: null, continuous: false, state: { ...state, seenPrevFrame: false } }
  return { mainPose: picked, continuous: false, state: { last: picked, lastTime: time, seenPrevFrame: true } }
}
