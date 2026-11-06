import { describe, expect, it } from 'vitest'
import { clipsFromIntervals, mergeOverlaps, trimClip, type EditClip } from './clips'

const limits = { duration: 60, minSec: 0.5, keyframes: null }
const clip = (id: number, start: number, end: number, keep = true): EditClip => ({ id, start, end, keep })

describe('clipsFromIntervals', () => {
  it('番号を振って、すべて「残す」にする', () => {
    expect(clipsFromIntervals([{ start: 1, end: 2 }, { start: 5, end: 8 }])).toEqual([clip(0, 1, 2), clip(1, 5, 8)])
  })
})

describe('mergeOverlaps', () => {
  it('重なったクリップを1つにまとめ、どちらかが残すなら残す', () => {
    expect(mergeOverlaps([clip(0, 0, 5, false), clip(1, 4, 9, true)])).toEqual([clip(0, 0, 9, true)])
  })

  it('接しているだけのクリップはまとめない', () => {
    expect(mergeOverlaps([clip(0, 0, 5), clip(1, 5, 9)])).toHaveLength(2)
  })

  it('指定したクリップの番号を残す', () => {
    expect(mergeOverlaps([clip(0, 0, 5), clip(1, 4, 9)], 1)[0].id).toBe(1)
  })

  it('開始順に並べ直す', () => {
    expect(mergeOverlaps([clip(1, 10, 12), clip(0, 1, 2)]).map((c) => c.id)).toEqual([0, 1])
  })
})

describe('trimClip', () => {
  const clips = [clip(0, 2, 5), clip(1, 10, 14), clip(2, 20, 25)]

  it('終わりを伸ばす・縮める', () => {
    expect(trimClip(clips, 1, 'end', 16, limits)[1]).toEqual(clip(1, 10, 16))
    expect(trimClip(clips, 1, 'end', 12, limits)[1]).toEqual(clip(1, 10, 12))
  })

  it('最短の長さより短くしない', () => {
    expect(trimClip(clips, 1, 'end', 3, limits)[1]).toEqual(clip(1, 10, 10.5))
    expect(trimClip(clips, 1, 'start', 20, limits)[1]).toEqual(clip(1, 13.5, 14))
  })

  it('動画の範囲に収める', () => {
    expect(trimClip(clips, 2, 'end', 99, limits)[2].end).toBe(60)
    expect(trimClip(clips, 0, 'start', -3, limits)[0].start).toBe(0)
  })

  it('伸ばして他のクリップと重なったら合体する', () => {
    const result = trimClip(clips, 1, 'end', 21, limits)
    expect(result).toEqual([clip(0, 2, 5), clip(1, 10, 25)])
  })

  it('開始を伸ばして前のクリップと重なったら合体し、動かしたクリップの番号を残す', () => {
    const result = trimClip(clips, 1, 'start', 4, limits)
    expect(result).toEqual([clip(1, 2, 14), clip(2, 20, 25)])
  })

  it('開始位置を最も近いキーフレームに吸着させる', () => {
    const kf = { ...limits, keyframes: [0, 9, 11, 13] }
    expect(trimClip(clips, 1, 'start', 10.8, kf)[1].start).toBe(11)
    expect(trimClip(clips, 1, 'start', 9.4, kf)[1].start).toBe(9)
  })

  it('吸着すると短すぎるときは手前のキーフレームにする', () => {
    const kf = { ...limits, keyframes: [0, 9, 13, 14] }
    expect(trimClip(clips, 1, 'start', 13.9, kf)[1].start).toBe(13)
  })

  it('対象がなければそのまま返す', () => {
    expect(trimClip(clips, 9, 'end', 30, limits)).toEqual(clips)
  })
})
