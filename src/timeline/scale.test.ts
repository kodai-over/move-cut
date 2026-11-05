import { describe, expect, it } from 'vitest'
import { clampZoom, fitZoom, scrollForAnchor, timeToX, waveformColumns, xToTime } from './scale'

describe('座標の変換', () => {
  it('時刻とx座標を行き来できる', () => {
    expect(timeToX(2.5, 40)).toBe(100)
    expect(xToTime(100, 40, 10)).toBe(2.5)
  })
  it('範囲外のx座標は0〜長さに収める', () => {
    expect(xToTime(-5, 40, 10)).toBe(0)
    expect(xToTime(9999, 40, 10)).toBe(10)
  })
})

describe('拡大率', () => {
  it('全体が幅に収まる値', () => {
    expect(fitZoom(400, 100)).toBe(4)
  })
  it('全体表示より縮小せず、上限より拡大しない', () => {
    expect(clampZoom(1, 4, 240)).toBe(4)
    expect(clampZoom(500, 4, 240)).toBe(240)
    expect(clampZoom(30, 4, 240)).toBe(30)
  })
  it('短い動画で全体表示が上限を超えるときは全体表示を優先する', () => {
    expect(clampZoom(100, 300, 240)).toBe(300)
  })
  it('拡大しても基準の時刻が同じ位置に残る', () => {
    // 10秒の位置を画面の100pxの位置に保つ
    expect(scrollForAnchor(10, 100, 40)).toBe(300)
    expect(scrollForAnchor(1, 100, 40)).toBe(0)
  })
})

describe('waveformColumns', () => {
  const times = [0, 0.5, 1, 1.5, 2, 2.5]
  const values = [0.1, 0.3, 0.2, 0.5, 0.0, 0.4]
  it('1pxに複数サンプルが入るときは最大値', () => {
    // 1秒=1px：0〜1秒が列0、1〜2秒が列1、2〜3秒が列2
    expect(waveformColumns(times, values, 1, 0, 3)).toEqual([0.3, 0.5, 0.4])
  })
  it('見えている範囲だけを返し、サンプルのない列は null', () => {
    // 1秒=4px、x=4から6px分（1〜2.5秒）
    expect(waveformColumns(times, values, 4, 4, 6)).toEqual([0.2, null, 0.5, null, 0.0, null])
  })
})
