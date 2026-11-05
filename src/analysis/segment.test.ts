import { describe, expect, it } from 'vitest'
import { buildClips, detectMotion, segmentMotion } from './segment'
import type { MotionSample } from './types'
import type { SegmentParams } from '../config'

const FP = { startHoldSec: 0.3, freezeLookbackSec: 1, freezePeakRatio: 2, freezeMinTrunkDeg: 45, freezeMinSec: 0.5, freezeMaxSec: 5 }
const P: SegmentParams = {
  startThreshold: 0.1,
  endThreshold: 0.06,
  stillSec: 2,
  marginBeforeSec: 0,
  marginAfterSec: 0,
  mergeSec: 0,
  minClipSec: 0,
}

/** 10fps のサンプル列を作る。各要素は [スコア, 体幹角度] を区間の秒数ぶん並べる */
function series(...parts: [sec: number, score: number, angle?: number | null][]): MotionSample[] {
  const out: MotionSample[] = []
  for (const [sec, score, angle = 0] of parts) {
    const n = Math.round(sec * 10)
    for (let k = 0; k < n; k++) {
      out.push({
        time: Math.round(out.length) / 10,
        skeletonScore: score,
        diffScore: null,
        frameDiff: null,
        score,
        source: 'skeleton',
        trunkAngle: angle,
        poseCount: 1,
      })
    }
  }
  return out
}

describe('detectMotion', () => {
  it('静止→動き→静止で1区間（開始は上回った最初、終了は下回った最初）', () => {
    const s = series([3, 0.02], [4, 0.15], [3, 0.02])
    expect(detectMotion(s, P, FP).motions).toEqual([{ start: 3, end: 7 }])
  })

  it('開始閾値を上回るのが0.3秒未満なら開始しない', () => {
    const s = series([3, 0.02], [0.2, 0.15], [3, 0.02])
    expect(detectMotion(s, P, FP).motions).toEqual([])
  })

  it('ちょうど0.3秒上回れば開始する', () => {
    const s = series([3, 0.02], [0.3, 0.15], [3, 0.02])
    expect(detectMotion(s, P, FP).motions).toHaveLength(1)
  })

  it('終了閾値と開始閾値の間ではチラつかずに動きが続く', () => {
    const s = series([1, 0.02], [2, 0.15], [3, 0.08], [2, 0.15], [3, 0.02])
    expect(detectMotion(s, P, FP).motions).toEqual([{ start: 1, end: 8 }])
  })

  it('区切り静止秒数より短い静止では区切らない', () => {
    const s = series([1, 0.02], [2, 0.15], [1.5, 0.02], [2, 0.15], [3, 0.02])
    expect(detectMotion(s, P, FP).motions).toEqual([{ start: 1, end: 6.5 }])
  })

  it('区切り静止秒数以上の静止で2区間に分かれる', () => {
    const s = series([1, 0.02], [2, 0.15], [2.5, 0.02], [2, 0.15], [3, 0.02])
    expect(detectMotion(s, P, FP).motions).toEqual([
      { start: 1, end: 3 },
      { start: 5.5, end: 7.5 },
    ])
  })

  it('動画の最後まで動いていれば最後の時刻で終わる', () => {
    const s = series([1, 0.02], [2, 0.15])
    expect(detectMotion(s, P, FP).motions).toEqual([{ start: 1, end: 2.9 }])
  })

  describe('フリーズ判定', () => {
    it('大きな動きの直後に体幹が傾いた静止はフリーズとして区間に含める', () => {
      // 動き→体幹90度で3秒静止→起きて静止
      const s = series([1, 0.02], [2, 0.25], [3, 0.02, 90], [3, 0.02, 0])
      const r = detectMotion(s, P, FP)
      expect(r.freezes).toEqual([{ start: 3, end: 6 }])
      expect(r.motions).toEqual([{ start: 1, end: 6 }])
    })

    it('体幹が起きていればフリーズにならない', () => {
      const s = series([1, 0.02], [2, 0.25], [3, 0.02, 10])
      const r = detectMotion(s, P, FP)
      expect(r.freezes).toEqual([])
      expect(r.motions).toEqual([{ start: 1, end: 3 }])
    })

    it('直前の動きが開始閾値の2倍未満ならフリーズにならない', () => {
      const s = series([1, 0.02], [2, 0.15], [3, 0.02, 90])
      expect(detectMotion(s, P, FP).freezes).toEqual([])
    })

    it('体幹角度が取れないフレームはフリーズにならない', () => {
      const s = series([1, 0.02], [2, 0.25], [3, 0.02, null])
      expect(detectMotion(s, P, FP).freezes).toEqual([])
    })

    it('フリーズは最大5秒まで。超えた分は静止として数える', () => {
      const s = series([1, 0.02], [2, 0.25], [9, 0.02, 90])
      const r = detectMotion(s, P, FP)
      expect(r.freezes).toEqual([{ start: 3, end: 8 }])
      expect(r.motions).toEqual([{ start: 1, end: 8 }])
    })

    it('0.5秒未満の一瞬の傾きはフリーズにせず、静止はその時刻から数える', () => {
      // 動き→体幹90度で0.3秒→起きて静止
      const s = series([1, 0.02], [2, 0.25], [0.3, 0.02, 90], [3, 0.02, 0])
      const r = detectMotion(s, P, FP)
      expect(r.freezes).toEqual([])
      expect(r.motions).toEqual([{ start: 1, end: 3 }])
    })

    it('フリーズの後に動きが再開すれば区間は続く', () => {
      const s = series([1, 0.02], [2, 0.25], [3, 0.02, 90], [2, 0.2], [3, 0.02])
      const r = detectMotion(s, P, FP)
      expect(r.freezes).toEqual([{ start: 3, end: 6 }])
      expect(r.motions).toEqual([{ start: 1, end: 8 }])
    })
  })
})

describe('buildClips', () => {
  const base = { ...P, marginBeforeSec: 0.5, marginAfterSec: 0.7, mergeSec: 1, minClipSec: 1.5 }

  it('前後に余白を付け、動画の範囲に収める', () => {
    expect(buildClips([{ start: 0.2, end: 5 }], 5.3, base, 'idea')).toEqual([{ start: 0, end: 5.3 }])
    expect(buildClips([{ start: 2, end: 4 }], 10, base, 'idea')).toEqual([{ start: 1.5, end: 4.7 }])
  })

  it('余白を付けた後の間隔が結合秒数未満ならまとめる', () => {
    const r = buildClips(
      [
        { start: 2, end: 4 },
        { start: 6, end: 8 },
      ],
      20,
      base,
      'idea',
    )
    // 4.7 と 5.5 の間隔 0.8秒 < 1秒
    expect(r).toEqual([{ start: 1.5, end: 8.7 }])
  })

  it('最小クリップ長未満は捨てる', () => {
    const r = buildClips([{ start: 2, end: 2.2 }], 20, base, 'idea')
    expect(r).toEqual([])
  })

  it('通し練習モードは最初の開始〜最後の終了を1区間にする', () => {
    const r = buildClips(
      [
        { start: 2, end: 4 },
        { start: 10, end: 12 },
      ],
      20,
      base,
      'run',
    )
    expect(r).toEqual([{ start: 1.5, end: 12.7 }])
  })
})

describe('segmentMotion', () => {
  it('最後まで動いている区間は、最後のサンプルではなく動画の長さまで余白を付ける', () => {
    const params = { ...P, marginAfterSec: 0.7 }
    const s = series([1, 0.02], [2, 0.15])
    expect(segmentMotion(s, 3.05, params, 'idea', FP).clips).toEqual([{ start: 1, end: 3.05 }])
  })

  it('捨てた区間のフリーズは返さない', () => {
    const params = { ...P, minClipSec: 10 }
    const s = series([1, 0.02], [2, 0.25], [3, 0.02, 90], [3, 0.02, 0])
    expect(segmentMotion(s, 10, params, 'idea', FP)).toEqual({ clips: [], freezes: [] })
  })
})
