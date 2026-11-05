import { describe, expect, it } from 'vitest'
import { compareFileNames, globalClipId, locate, shiftIntervals, shiftTimes, sourceOffsets, splitClipId } from './sources'

describe('sourceOffsets', () => {
  it('各動画の先頭の時刻を返す', () => {
    expect(sourceOffsets([10, 5, 20])).toEqual([0, 10, 15])
  })
  it('空なら空', () => {
    expect(sourceOffsets([])).toEqual([])
  })
})

describe('locate', () => {
  const durations = [10, 5, 20]
  const offsets = sourceOffsets(durations)
  it('全体の時刻を動画と動画内の時刻に直す', () => {
    expect(locate(3, offsets, durations)).toEqual({ index: 0, local: 3 })
    expect(locate(12, offsets, durations)).toEqual({ index: 1, local: 2 })
    expect(locate(15, offsets, durations)).toEqual({ index: 2, local: 0 })
  })
  it('範囲外は先頭・末尾に収める', () => {
    expect(locate(-1, offsets, durations)).toEqual({ index: 0, local: 0 })
    expect(locate(99, offsets, durations)).toEqual({ index: 2, local: 20 })
  })
})

describe('shiftIntervals / shiftTimes', () => {
  it('ほかの値を保ったままずらす', () => {
    expect(shiftIntervals([{ start: 1, end: 2, keep: true }], 10)).toEqual([{ start: 11, end: 12, keep: true }])
    expect(shiftTimes([{ time: 1, url: 'a' }], 5)).toEqual([{ time: 6, url: 'a' }])
  })
})

describe('globalClipId / splitClipId', () => {
  it('動画とクリップの番号を往復できる', () => {
    expect(splitClipId(globalClipId(3, 7))).toEqual({ source: 3, localId: 7 })
    expect(splitClipId(globalClipId(0, 0))).toEqual({ source: 0, localId: 0 })
  })
})

describe('compareFileNames', () => {
  it('数字の大小で並べる', () => {
    expect(['IMG_10.MOV', 'IMG_9.MOV', 'IMG_100.MOV'].sort(compareFileNames)).toEqual([
      'IMG_9.MOV',
      'IMG_10.MOV',
      'IMG_100.MOV',
    ])
  })
})
