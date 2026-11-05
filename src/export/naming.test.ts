import { describe, expect, it } from 'vitest'
import { clipFileName, cutArgs, splitFileName, videoMimeType } from './naming'

describe('splitFileName', () => {
  it('拡張子を小文字にして分ける', () => {
    expect(splitFileName('IMG_1234.MOV')).toEqual({ base: 'IMG_1234', ext: 'mov' })
  })
  it('最後のドットで分ける', () => {
    expect(splitFileName('a.b.mp4')).toEqual({ base: 'a.b', ext: 'mp4' })
  })
  it('拡張子がなければ mov', () => {
    expect(splitFileName('video')).toEqual({ base: 'video', ext: 'mov' })
    expect(splitFileName('.hidden')).toEqual({ base: '.hidden', ext: 'mov' })
  })
})

describe('clipFileName', () => {
  it('仕様の例どおり', () => {
    expect(clipFileName('IMG_1234.MOV', 3, 75.8)).toBe('IMG_1234_03_75s.mov')
  })
  it('元の拡張子を使う', () => {
    expect(clipFileName('dance.mp4', 12, 0)).toBe('dance_12_0s.mp4')
  })
})

describe('videoMimeType', () => {
  it('mov は quicktime、mp4 は mp4', () => {
    expect(videoMimeType('a.mov')).toBe('video/quicktime')
    expect(videoMimeType('a.MP4')).toBe('video/mp4')
  })
})

describe('cutArgs', () => {
  it('入力前に開始位置、長さは -t で指定し、コピーで切り出す', () => {
    expect(cutArgs('/in/a.mov', 'out.mov', 5.25, 10)).toEqual([
      '-ss', '5.250', '-i', '/in/a.mov', '-t', '4.750',
      '-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '0',
      '-c', 'copy', '-avoid_negative_ts', 'make_zero', 'out.mov',
    ])
  })
  it('負の開始位置は0にする', () => {
    const args = cutArgs('/in/a.mov', 'o.mov', -1, 2)
    expect(args[1]).toBe('0.000')
    expect(args[5]).toBe('2.000')
  })
})
