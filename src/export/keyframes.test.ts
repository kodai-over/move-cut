import { describe, expect, it } from 'vitest'
import { nearestKeyframe, parseKeyframeTimes, snapToKeyframe } from './keyframes'

describe('parseKeyframeTimes', () => {
  it('K の付いた行だけを時刻順に取り出す', () => {
    const csv = ['0.000000,K__', '0.033333,___', '0.966667,K__', '0.500000,__', '1.933333,K_', ''].join('\n')
    expect(parseKeyframeTimes(csv)).toEqual([0, 0.966667, 1.933333])
  })
  it('数値でない行・重複は無視する', () => {
    expect(parseKeyframeTimes('N/A,K\n1.0,K\n1.0,K\r\n')).toEqual([1])
  })
})

describe('snapToKeyframe', () => {
  const ks = [0, 0.97, 1.93, 2.9]
  it('その時刻以下で最も近いキーフレーム', () => {
    expect(snapToKeyframe(1.5, ks)).toBe(0.97)
    expect(snapToKeyframe(1.93, ks)).toBe(1.93)
    expect(snapToKeyframe(10, ks)).toBe(2.9)
  })
  it('キーフレームがなければそのまま', () => {
    expect(snapToKeyframe(1.5, [])).toBe(1.5)
  })
})

describe('nearestKeyframe', () => {
  it('前後で近い方', () => {
    expect(nearestKeyframe(1.6, [0, 0.97, 1.93])).toBe(1.93)
    expect(nearestKeyframe(1.2, [0, 0.97, 1.93])).toBe(0.97)
  })
})
