import { describe, expect, it } from 'vitest'
import { INITIAL_TRACK_STATE, findNearestPose, trackMainPose } from './tracking'
import type { Pose } from './types'

const PARAMS = { trackMaxCenterShift: 0.8, trackLostResetSec: 2, trackReacquireMinSizeRatio: 0.5, trackReacquireRefMaxRatio: 0.3 }
/** 解析画像の対角線（十分大きくして上限が効かないようにする） */
const FRAME = 10000

/** (x, y) を左上とする size 四方の骨格 */
function pose(x: number, y: number, size = 100): Pose {
  return Array.from({ length: 33 }, (_, i) => ({
    x: x + ((i % 6) / 5) * size,
    y: y + (Math.floor(i / 6) / 5) * size,
    confidence: 0.9,
  }))
}

describe('findNearestPose', () => {
  it('中心が最も近い人物を返す', () => {
    const ref = pose(0, 0)
    const near = pose(20, 0)
    const far = pose(60, 0)
    expect(findNearestPose([far, near], ref, 0.8)).toBe(near)
  })
  it('移動量が上限を超える人物しかいなければ null', () => {
    // 対角線 約141px × 0.8 ≒ 113px を超える
    expect(findNearestPose([pose(200, 0)], pose(0, 0), 0.8)).toBeNull()
  })
})

describe('trackMainPose', () => {
  it('初回は最大の人物を選ぶ（追跡は未継続）', () => {
    const small = pose(0, 0, 50)
    const large = pose(300, 0, 200)
    const r = trackMainPose([small, large], INITIAL_TRACK_STATE, 0, FRAME, PARAMS)
    expect(r.mainPose).toBe(large)
    expect(r.continuous).toBe(false)
  })

  it('より大きい別人が現れても、前フレームの本人に近い人物を追い続ける', () => {
    const me = pose(0, 0, 100)
    const r1 = trackMainPose([me], INITIAL_TRACK_STATE, 0, FRAME, PARAMS)
    const meMoved = pose(10, 5, 100)
    const bigOther = pose(400, 0, 300)
    const r2 = trackMainPose([bigOther, meMoved], r1.state, 0.1, FRAME, PARAMS)
    expect(r2.mainPose).toBe(meMoved)
    expect(r2.continuous).toBe(true)
  })

  it('本人を見失ったら別人に乗り換えず null を返す', () => {
    const r1 = trackMainPose([pose(0, 0)], INITIAL_TRACK_STATE, 0, FRAME, PARAMS)
    const r2 = trackMainPose([pose(500, 0, 300)], r1.state, 0.1, FRAME, PARAMS)
    expect(r2.mainPose).toBeNull()
    expect(r2.continuous).toBe(false)
  })

  it('見失い後に元の位置付近で再検出したら、そのフレームは継続扱いにしない', () => {
    const r1 = trackMainPose([pose(0, 0)], INITIAL_TRACK_STATE, 0, FRAME, PARAMS)
    const r2 = trackMainPose([], r1.state, 0.1, FRAME, PARAMS)
    const back = pose(5, 0)
    const r3 = trackMainPose([back], r2.state, 0.2, FRAME, PARAMS)
    expect(r3.mainPose).toBe(back)
    expect(r3.continuous).toBe(false)
    const r4 = trackMainPose([pose(8, 0)], r3.state, 0.3, FRAME, PARAMS)
    expect(r4.continuous).toBe(true)
  })

  it('選び直すとき、最後に見た本人より大幅に小さい人物は選ばない', () => {
    const r1 = trackMainPose([pose(0, 0, 200)], INITIAL_TRACK_STATE, 0, FRAME, PARAMS)
    const smallFar = pose(600, 0, 60) // 奥にいる他人
    const r2 = trackMainPose([smallFar], r1.state, 3, FRAME, PARAMS)
    expect(r2.mainPose).toBeNull()
    const back = pose(300, 0, 180)
    const r3 = trackMainPose([smallFar, back], r2.state, 4, FRAME, PARAMS)
    expect(r3.mainPose).toBe(back)
  })

  it('カメラ直前で見失っても、遠くに戻った本人を選び直せる', () => {
    const closeUp = pose(0, 0, 1000) // 画面いっぱい
    const r1 = trackMainPose([closeUp], INITIAL_TRACK_STATE, 0, 1500, PARAMS)
    const farMe = pose(300, 300, 300)
    const r2 = trackMainPose([farMe], r1.state, 3, 1500, PARAMS)
    expect(r2.mainPose).toBe(farMe)
  })

  it('見失いが一定時間続いたら最大の人物を選び直す', () => {
    const r1 = trackMainPose([pose(0, 0)], INITIAL_TRACK_STATE, 0, FRAME, PARAMS)
    const other = pose(500, 0, 300)
    const r2 = trackMainPose([other], r1.state, 1.0, FRAME, PARAMS)
    expect(r2.mainPose).toBeNull()
    const r3 = trackMainPose([other], r2.state, 2.5, FRAME, PARAMS)
    expect(r3.mainPose).toBe(other)
    expect(r3.continuous).toBe(false)
  })
})
