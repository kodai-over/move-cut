import { describe, expect, it } from 'vitest'
import {
  LANDMARK,
  boundingBox,
  buildMotionSeries,
  diffRatio,
  expandBox,
  movingAverage,
  nearCameraMask,
  selectMainPose,
  skeletonScore,
  toCsv,
  toGrayscale,
  trunkAngle,
} from './motion'
import type { FrameObservation, Pose } from './types'

const PARAMS = {
  sampleFps: 10,
  jointMinConfidence: 0.5,
  minReliableJoints: 6,
  smoothingWindowSec: 0.5,
  nearCameraFrameDiff: 0.1,
  nearCameraMarginSec: 1,
}

/** 33点すべてを同じ信頼度で、指定の矩形内に並べた骨格を作る */
function makePose(opts: { x?: number; y?: number; size?: number; confidence?: number } = {}): Pose {
  const { x = 0, y = 0, size = 100, confidence = 0.9 } = opts
  return Array.from({ length: 33 }, (_, i) => ({
    x: x + ((i % 6) / 5) * size,
    y: y + (Math.floor(i / 6) / 5) * size,
    confidence,
  }))
}

function shift(pose: Pose, dx: number, dy: number): Pose {
  return pose.map((j) => ({ ...j, x: j.x + dx, y: j.y + dy }))
}

/** 指定した関節だけを動かす */
function moveJoints(pose: Pose, joints: readonly number[], dx: number, dy: number): Pose {
  return pose.map((j, i) => (joints.includes(i) ? { ...j, x: j.x + dx, y: j.y + dy } : j))
}

/** 肩と腰の位置だけを指定した骨格 */
function trunkPose(shoulder: { x: number; y: number }, hip: { x: number; y: number }): Pose {
  const pose = makePose()
  pose[LANDMARK.leftShoulder] = { ...shoulder, x: shoulder.x - 10, confidence: 0.9 }
  pose[LANDMARK.rightShoulder] = { ...shoulder, x: shoulder.x + 10, confidence: 0.9 }
  pose[LANDMARK.leftHip] = { ...hip, x: hip.x - 10, confidence: 0.9 }
  pose[LANDMARK.rightHip] = { ...hip, x: hip.x + 10, confidence: 0.9 }
  return pose
}

describe('selectMainPose', () => {
  it('検出なしなら null', () => {
    expect(selectMainPose([])).toBeNull()
  })
  it('ボックスが最大の人物を選ぶ', () => {
    const small = makePose({ size: 50 })
    const large = makePose({ size: 200 })
    expect(selectMainPose([small, large])).toBe(large)
  })
})

describe('skeletonScore', () => {
  it('前フレームがなければ null', () => {
    expect(skeletonScore(null, makePose())).toEqual({ score: null, reliableJoints: 0 })
  })
  it('体全体が平行移動しただけ（歩き）なら0', () => {
    const a = makePose({ size: 100 })
    const { score, reliableJoints } = skeletonScore(a, shift(a, 30, 10), 0.5)
    expect(reliableJoints).toBe(13)
    expect(score).toBeCloseTo(0)
  })
  it('体の中での動きを、平均移動量を差し引いてボックス対角線で正規化する', () => {
    const a = makePose({ size: 100 })
    // 13関節のうち1関節（右手首）だけ13px動く → 平均移動量1px。
    // 右手首は12px、残り12関節は1pxずつ平均からずれる → 合計24px / 13関節
    const b = moveJoints(a, [LANDMARK.rightWrist], 13, 0)
    expect(skeletonScore(a, b, 0.5).score).toBeCloseTo(24 / 13 / Math.hypot(100, 100))
  })
  it('手足の動きは、体ごと移動していても同じスコア', () => {
    const a = makePose({ size: 100 })
    const limb = moveJoints(a, [LANDMARK.rightWrist, LANDMARK.leftAnkle], 10, 5)
    const s1 = skeletonScore(a, limb).score!
    const s2 = skeletonScore(a, shift(limb, 20, -8)).score!
    expect(s2).toBeCloseTo(s1)
  })
  it('信頼度が低い関節は数えない', () => {
    const a = makePose({ confidence: 0.3 })
    const b = shift(a, 1, 0)
    expect(skeletonScore(a, b, 0.5)).toEqual({ score: null, reliableJoints: 0 })
  })
  it('体が大きく写っても同じ動きなら同じスコア', () => {
    const near = makePose({ size: 200 })
    const far = makePose({ size: 100 })
    const s1 = skeletonScore(near, moveJoints(near, [LANDMARK.rightWrist], 10, 0)).score!
    const s2 = skeletonScore(far, moveJoints(far, [LANDMARK.rightWrist], 5, 0)).score!
    expect(s1).toBeCloseTo(s2)
  })
})

describe('trunkAngle', () => {
  it('直立は0度', () => {
    expect(trunkAngle(trunkPose({ x: 50, y: 0 }, { x: 50, y: 100 }))).toBeCloseTo(0)
  })
  it('横倒しは90度', () => {
    expect(trunkAngle(trunkPose({ x: 0, y: 50 }, { x: 100, y: 50 }))).toBeCloseTo(90)
  })
  it('逆立ちは180度', () => {
    expect(trunkAngle(trunkPose({ x: 50, y: 100 }, { x: 50, y: 0 }))).toBeCloseTo(180)
  })
  it('肩・腰が不確かなら null', () => {
    const p = trunkPose({ x: 50, y: 0 }, { x: 50, y: 100 })
    p[LANDMARK.leftHip] = { ...p[LANDMARK.leftHip], confidence: 0.1 }
    expect(trunkAngle(p)).toBeNull()
    expect(trunkAngle(null)).toBeNull()
  })
})

describe('toGrayscale', () => {
  it('白は255、黒は0', () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255])
    expect(Array.from(toGrayscale(rgba))).toEqual([255, 0])
  })
})

describe('diffRatio', () => {
  const w = 4
  const h = 2
  it('閾値以上の差がある画素の割合', () => {
    const prev = new Uint8Array(8)
    const cur = new Uint8Array([30, 30, 10, 0, 0, 0, 0, 25])
    expect(diffRatio(prev, cur, w, h, 25)).toBeCloseTo(3 / 8)
  })
  it('ROI内だけを数える', () => {
    const prev = new Uint8Array(8)
    const cur = new Uint8Array([30, 30, 0, 0, 0, 0, 0, 30])
    expect(diffRatio(prev, cur, w, h, 25, { minX: 0, minY: 0, maxX: 2, maxY: 1 })).toBe(1)
  })
  it('ROIが画像外なら全体で数える', () => {
    const prev = new Uint8Array(8)
    const cur = new Uint8Array([30, 0, 0, 0, 0, 0, 0, 0])
    expect(diffRatio(prev, cur, w, h, 25, { minX: 10, minY: 10, maxX: 20, maxY: 20 })).toBeCloseTo(1 / 8)
  })
})

describe('expandBox', () => {
  it('各辺を広げて画像内に収める', () => {
    expect(expandBox({ minX: 10, minY: 10, maxX: 30, maxY: 50 }, 0.5, 35, 100)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 35,
      maxY: 70,
    })
  })
})

describe('movingAverage', () => {
  it('中心化した窓で平均し、端は窓を縮める', () => {
    expect(movingAverage([0, 0, 10, 0, 0], 3)).toEqual([0, 10 / 3, 10 / 3, 10 / 3, 0])
  })
  it('偶数の窓幅は奇数に切り下げる', () => {
    expect(movingAverage([0, 0, 9, 0, 0], 4)).toEqual([0, 3, 3, 3, 0])
  })
  it('窓幅1は元の値のまま', () => {
    expect(movingAverage([1, 2, 3], 1)).toEqual([1, 2, 3])
  })
  it('空配列', () => {
    expect(movingAverage([], 5)).toEqual([])
  })
})

describe('buildMotionSeries', () => {
  const frame = (
    time: number,
    mainPose: Pose | null,
    diffScore: number | null,
    continuous = true,
    frameDiff: number | null = 0.01,
  ): FrameObservation => ({
    time,
    mainPose,
    continuous,
    poseCount: mainPose ? 1 : 0,
    diffScore,
    frameDiff,
  })
  const NO_SMOOTH = { ...PARAMS, smoothingWindowSec: 0.1 }
  const wrist = (p: Pose, dx: number) => moveJoints(p, [LANDMARK.rightWrist], dx, 0)

  it('信頼できる関節が足りれば骨格、なければ差分、どちらもなければ0', () => {
    const p = makePose()
    const frames = [frame(0, p, null), frame(0.1, wrist(p, 13), 0.2), frame(0.2, null, 0.3), frame(0.3, p, 0.1), frame(0.4, wrist(p, 13), 0.2)]
    const s = buildMotionSeries(frames, NO_SMOOTH)
    expect(s.map((r) => r.source)).toEqual(['outside', 'skeleton', 'diff', 'diff', 'skeleton'])
    expect(s[2].score).toBeCloseTo(0.3)
  })

  it('骨格を最初に検出する前・最後に検出した後は数えない', () => {
    const p = makePose()
    const frames = [
      frame(0, null, null),
      frame(0.1, null, 0.5), // 本人が来る前（カメラの前を通る足など）
      frame(0.2, p, 0.4),
      frame(0.3, wrist(p, 13), 0.2),
      frame(0.4, null, 0.6), // 最後の骨格より後
    ]
    const s = buildMotionSeries(frames, NO_SMOOTH)
    expect(s.map((r) => r.source)).toEqual(['outside', 'outside', 'outside', 'skeleton', 'outside'])
    expect(s.map((r) => r.score)).toEqual([0, 0, 0, s[3].score, 0])
    expect(s[3].score).toBeGreaterThan(0)
  })

  it('一度も骨格を検出できなければ差分スコアだけで判定する', () => {
    const frames = [frame(0, null, null), frame(0.1, null, 0.3)]
    const s = buildMotionSeries(frames, NO_SMOOTH)
    expect(s.map((r) => r.source)).toEqual(['none', 'diff'])
    expect(s[1].score).toBeCloseTo(0.3)
  })

  it('カメラ付近にいる時間とその前後1秒は数えない', () => {
    const p = makePose()
    const frames = Array.from({ length: 41 }, (_, i) => {
      const t = i / 10
      // 2.0秒だけ画面全体が大きく変わる
      return frame(t, i % 2 ? wrist(p, 13) : p, 0.2, true, i === 20 ? 0.3 : 0.01)
    })
    const s = buildMotionSeries(frames, NO_SMOOTH)
    const near = s.filter((r) => r.source === 'nearCamera').map((r) => r.time)
    expect(near[0]).toBeCloseTo(1.0)
    expect(near[near.length - 1]).toBeCloseTo(3.0)
    expect(near).toHaveLength(21)
    expect(s.filter((r) => r.source === 'nearCamera').every((r) => r.score === 0)).toBe(true)
    expect(s[5].score).toBeGreaterThan(0)
  })

  it('関節が6個未満なら差分スコアを採用する', () => {
    const a = makePose({ confidence: 0.2 })
    for (const i of [0, 11, 12, 13, 14]) a[i] = { ...a[i], confidence: 0.9 } // 5関節だけ信頼できる
    const frames = [frame(0, a, null), frame(0.1, shift(a, 1, 0), 0.4)]
    const s = buildMotionSeries(frames, NO_SMOOTH)
    expect(s[1].source).toBe('diff')
    expect(s[1].skeletonScore).not.toBeNull()
  })

  it('追跡が途切れたフレームは骨格スコアを計算せず差分を使う', () => {
    const a = makePose({ x: 0 })
    const other = makePose({ x: 500 }) // 別人
    const frames = [frame(0, a, null), frame(0.1, other, 0.02, false)]
    const s = buildMotionSeries(frames, NO_SMOOTH)
    expect(s[1].skeletonScore).toBeNull()
    expect(s[1].source).toBe('diff')
    expect(s[1].score).toBeCloseTo(0.02)
  })

  it('0.5秒の移動平均で平滑化する', () => {
    const frames = [0, 0, 1, 0, 0].map((d, i) => frame(i / 10, null, d))
    const s = buildMotionSeries(frames, PARAMS)
    expect(s[2].score).toBeCloseTo(1 / 5)
  })

  it('空の入力は空の結果', () => {
    expect(buildMotionSeries([], PARAMS)).toEqual([])
  })
})

describe('nearCameraMask', () => {
  const fs = (diffs: (number | null)[]) => diffs.map((d, i) => ({ time: i / 10, frameDiff: d }))
  it('閾値以上のフレームと前後の秒数を含める', () => {
    expect(nearCameraMask(fs([0, 0, 0, 0.2, 0, 0, 0]), 0.1, 0.2)).toEqual([false, true, true, true, true, true, false])
  })
  it('null は該当しない', () => {
    expect(nearCameraMask(fs([null, 0.05]), 0.1, 1)).toEqual([false, false])
  })
})

describe('toCsv', () => {
  it('ヘッダーと行を出力し、null は空欄にする', () => {
    const csv = toCsv([
      { time: 0.1, skeletonScore: null, diffScore: 0.25, frameDiff: 0.03, score: 0.125, source: 'diff', trunkAngle: null, poseCount: 0 },
      { time: 0.2, skeletonScore: null, diffScore: 0.4, frameDiff: 0.3, score: 0, source: 'nearCamera', trunkAngle: null, poseCount: 0 },
    ])
    const lines = csv.replace('﻿', '').trim().split('\n')
    expect(lines[0]).toBe(
      '時刻(秒),骨格スコア,差分スコア,画面全体の差分,統合スコア(平滑化後),採用スコア,体幹角度(度),検出人数',
    )
    expect(lines[1]).toBe('0.10,,0.25000,0.03000,0.12500,差分,,0')
    expect(lines[2]).toBe('0.20,,0.40000,0.30000,0.00000,カメラ付近,,0')
  })
})

describe('boundingBox', () => {
  it('全関節を囲む', () => {
    expect(boundingBox(makePose({ x: 10, y: 20, size: 50 }))).toEqual({ minX: 10, minY: 20, maxX: 60, maxY: 70 })
  })
})
