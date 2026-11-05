// 動画1本を解析して動きスコアの時系列を返す（フレーム取得 → 骨格推定 → 差分 → 統合）
import { ANALYSIS } from '../config'
import { boundingBox, buildMotionSeries, diffRatio, expandBox, toGrayscale } from '../analysis/motion'
import { INITIAL_TRACK_STATE, trackMainPose } from '../analysis/tracking'
import type { FrameObservation, MotionSample } from '../analysis/types'
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

/** 解析結果。duration は動画の長さ（秒） */
export interface AnalysisResult {
  samples: MotionSample[]
  duration: number
}

export async function analyzeVideo(url: string, opts: AnalyzeOptions = {}): Promise<AnalysisResult> {
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
    let track = INITIAL_TRACK_STATE
    const frameDiagonal = Math.hypot(width, height)

    for (let i = 0; i < times.length; i++) {
      if (opts.signal?.aborted) throw new DOMException('中止しました', 'AbortError')
      const time = times[i]
      await seekTo(video, time)
      ctx.drawImage(video, 0, 0, width, height)
      const gray = toGrayscale(ctx.getImageData(0, 0, width, height).data)

      const poses = detector.detect(canvas, Math.round(time * 1000))
      // 差分の範囲は「最後に本人を見た位置」。見失って間もないうちはその位置を使い、
      // 画面全体（他人の動きを含む）で差分を取らないようにする。追跡を更新する前に決める
      const lastSeen =
        track.last && time - track.lastTime <= ANALYSIS.trackLostResetSec ? track.last : null
      const tracked = trackMainPose(poses, track, time, frameDiagonal)
      track = tracked.state
      const { mainPose, continuous } = tracked

      // 直前に本人を検出できていれば、その周辺だけで差分を取る
      const roi = lastSeen ? expandBox(boundingBox(lastSeen), ANALYSIS.diffRoiMargin, width, height) : null
      const diffScore = prevGray
        ? diffRatio(prevGray, gray, width, height, ANALYSIS.diffPixelThreshold, roi)
        : null

      // カメラ付近の判定用に、画面全体の差分も取る
      const frameDiff = prevGray
        ? diffRatio(prevGray, gray, width, height, ANALYSIS.diffPixelThreshold, null)
        : null

      frames.push({ time, mainPose, continuous, poseCount: poses.length, diffScore, frameDiff, frameHeight: height })
      prevGray = gray
      opts.onProgress?.((i + 1) / times.length)
    }

    if (frames.length === 0) throw new UserFacingError('解析できるフレームがありませんでした。動画が短すぎる可能性があります。')
    return { samples: buildMotionSeries(frames), duration: info.duration }
  } finally {
    detector.close()
    detach()
    video.removeAttribute('src')
    video.load()
  }
}
