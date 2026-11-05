import { describe, expect, it } from 'vitest'
import { estimateClipBytes, planBatches, type NumberedClip } from './batch'

const MB = 1024 * 1024
/** 1秒あたり10MBの動画（100秒で1000MB） */
const SRC = { bytes: 1000 * MB, duration: 100 }
const nc = (number: number, start: number, end: number): NumberedClip => ({ number, clip: { start, end } })

describe('estimateClipBytes', () => {
  it('長さに比例する', () => {
    expect(estimateClipBytes({ start: 10, end: 13 }, SRC.bytes, SRC.duration)).toBeCloseTo(30 * MB)
  })
  it('長さ0の動画は0', () => {
    expect(estimateClipBytes({ start: 0, end: 1 }, SRC.bytes, 0)).toBe(0)
  })
})

describe('planBatches', () => {
  it('上限以内なら1バッチ', () => {
    const clips = [nc(1, 0, 10), nc(2, 20, 30)]
    expect(planBatches(clips, SRC.bytes, SRC.duration, 400 * MB)).toEqual([clips])
  })
  it('上限を超える手前で分け、順番を保つ', () => {
    const clips = [nc(1, 0, 20), nc(2, 20, 40), nc(3, 40, 60)] // 各200MB
    expect(planBatches(clips, SRC.bytes, SRC.duration, 400 * MB)).toEqual([[clips[0], clips[1]], [clips[2]]])
  })
  it('1本で上限を超えるクリップは単独にする', () => {
    const clips = [nc(1, 0, 5), nc(2, 10, 60), nc(3, 70, 75)] // 50MB, 500MB, 50MB
    expect(planBatches(clips, SRC.bytes, SRC.duration, 400 * MB)).toEqual([[clips[0]], [clips[1]], [clips[2]]])
  })
  it('空なら空', () => {
    expect(planBatches([], SRC.bytes, SRC.duration, 400 * MB)).toEqual([])
  })
})
