// MediaPipe Pose Landmarker のラッパー。結果をピクセル座標の Pose[] に変換して返す
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import { ANALYSIS, ASSETS } from '../config'
import type { Pose } from '../analysis/types'

export interface PoseDetector {
  /** timestampMs は呼び出しごとに単調増加させる */
  detect(image: HTMLCanvasElement, timestampMs: number): Pose[]
  close(): void
}

export async function createPoseDetector(): Promise<PoseDetector> {
  const base = import.meta.env.BASE_URL
  const fileset = await FilesetResolver.forVisionTasks(base + ASSETS.mediapipeWasmDir)
  const create = (delegate: 'GPU' | 'CPU') =>
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: base + ASSETS.poseModelPath, delegate },
      runningMode: 'VIDEO',
      numPoses: ANALYSIS.maxPoses,
    })

  let landmarker: PoseLandmarker
  try {
    landmarker = await create('GPU')
  } catch {
    // GPU（WebGL）が使えない環境ではCPUで動かす
    landmarker = await create('CPU')
  }

  return {
    detect(image, timestampMs) {
      const result = landmarker.detectForVideo(image, timestampMs)
      const w = image.width
      const h = image.height
      return result.landmarks.map((lm) =>
        lm.map((p) => ({ x: p.x * w, y: p.y * h, confidence: p.visibility ?? 0 })),
      )
    },
    close() {
      landmarker.close()
    },
  }
}
