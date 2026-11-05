// 動画1本を解析して動きスコアの時系列を返す（フレーム取得 → 骨格推定 → 差分 → 統合）
import { ANALYSIS } from '../config'
import { boundingBox, buildMotionSeries, diffRatio, expandBox, selectMainPose, toGrayscale } from '../analysis/motion'
import type { FrameObservation, MotionSample, Pose } from '../analysis/types'
import {
  UserFacingError,
  analysisSize,
  createVideoElement,
  loadVideoInfo,
  prepareForFrameCapture,
  sampleTimes,
  seekTo,
} from './videoFile'

export interface AnalyzeOptions {
  onProgress?: (ratio: number) => void
  signal?: AbortSignal
}

export async function analyzeVideo(url: string, opts: AnalyzeOptions = {}): Promise<MotionSample[]> {
  const video = createVideoElement(url)
  const info = await loadVideoInfo(video)
  const { width, height } = analysisSize(info)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new UserFacingError('このブラウザでは画像処理（canvas）が使えません。')

  let detector
  try {
    // MediaPipe は大きいので解析開始時に読み込む
    const { createPoseDetector } = await import('./poseDetector')
    detector = await createPoseDetector()
  } catch (e) {
    console.error(e)
    throw new UserFacingError('骨格推定モデルの読み込みに失敗しました。通信状況を確認して、もう一度お試しください。')
  }

  const detach = await prepareForFrameCapture(video)
  try {
    const times = sampleTimes(info.duration)
    const frames: FrameObservation[] = []
    let prevGray: Uint8Array | null = null
    let prevPose: Pose | null = null

    for (let i = 0; i < times.length; i++) {
      if (opts.signal?.aborted) throw new DOMException('中止しました', 'AbortError')
      const time = times[i]
      await seekTo(video, time)
      ctx.drawImage(video, 0, 0, width, height)
      const gray = toGrayscale(ctx.getImageData(0, 0, width, height).data)

      const poses = detector.detect(canvas, Math.round(time * 1000))
      const mainPose = selectMainPose(poses)

      // 直前に本人を検出できていれば、その周辺だけで差分を取る
      const roi = prevPose ? expandBox(boundingBox(prevPose), ANALYSIS.diffRoiMargin, width, height) : null
      const diffScore = prevGray
        ? diffRatio(prevGray, gray, width, height, ANALYSIS.diffPixelThreshold, roi)
        : null

      frames.push({ time, mainPose, poseCount: poses.length, diffScore })
      prevGray = gray
      prevPose = mainPose
      opts.onProgress?.((i + 1) / times.length)
    }

    if (frames.length === 0) throw new UserFacingError('解析できるフレームがありませんでした。動画が短すぎる可能性があります。')
    return buildMotionSeries(frames)
  } finally {
    detector.close()
    detach()
    video.removeAttribute('src')
    video.load()
  }
}
