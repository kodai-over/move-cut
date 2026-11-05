// 動画ファイルの読み込みと、seek方式でのフレーム取得
import { ANALYSIS, SUPPORT } from '../config'

export interface VideoInfo {
  duration: number
  width: number
  height: number
}

/** 読み込み・解析で画面に表示するエラー（message は日本語） */
export class UserFacingError extends Error {}

/** 解析用の非表示 video 要素を作る */
export function createVideoElement(url: string): HTMLVideoElement {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = url
  return video
}

/**
 * フレームを canvas に描けるよう準備する
 * iOS Safari は DOM 外・未再生の video をデコードしないことがあるため、不可視で DOM に置き、一度再生して止める
 * 戻り値の関数で DOM から外す
 */
export async function prepareForFrameCapture(video: HTMLVideoElement): Promise<() => void> {
  Object.assign(video.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: '1px',
    height: '1px',
    opacity: '0',
    pointerEvents: 'none',
  })
  document.body.appendChild(video)
  try {
    await video.play()
  } catch {
    // 自動再生が拒否されても seek で描画できる環境があるため続行する
  }
  video.pause()
  return () => video.remove()
}

/** メタデータ（長さ・解像度）を読み込む。非対応形式ならエラー */
export function loadVideoInfo(video: HTMLVideoElement): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    const onLoaded = () => {
      cleanup()
      const { duration, videoWidth: width, videoHeight: height } = video
      if (!Number.isFinite(duration) || duration <= 0 || width === 0 || height === 0) {
        reject(new UserFacingError('動画の長さや解像度を読み取れませんでした。別の動画を選んでください。'))
        return
      }
      resolve({ duration, width, height })
    }
    const onError = () => {
      cleanup()
      reject(new UserFacingError('この動画は読み込めません。このブラウザが対応していない形式の可能性があります。'))
    }
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onLoaded)
      video.removeEventListener('error', onError)
    }
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      onLoaded()
      return
    }
    video.addEventListener('loadedmetadata', onLoaded)
    video.addEventListener('error', onError)
  })
}

/** 正式サポート範囲を超えていれば警告文を返す */
export function supportWarnings(info: VideoInfo): string[] {
  const warnings: string[] = []
  if (info.duration > SUPPORT.maxDurationSec) {
    warnings.push(`動画が${Math.round(SUPPORT.maxDurationSec / 60)}分を超えています。`)
  }
  if (Math.min(info.width, info.height) > SUPPORT.maxShortSidePx) {
    warnings.push(`解像度が${SUPPORT.maxShortSidePx}pを超えています。`)
  }
  return warnings
}

/** 解析用に縮小したサイズ（短辺 shortSidePx、拡大はしない） */
export function analysisSize(info: VideoInfo): { width: number; height: number } {
  const scale = Math.min(1, ANALYSIS.shortSidePx / Math.min(info.width, info.height))
  return { width: Math.round(info.width * scale), height: Math.round(info.height * scale) }
}

/** 指定時刻にシークして描画できる状態になるまで待つ */
export function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new UserFacingError('動画のフレーム取得が止まりました。アプリを開いたまま、もう一度お試しください。'))
    }, ANALYSIS.seekTimeoutMs)
    const onSeeked = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new UserFacingError('動画の読み込み中にエラーが起きました。'))
    }
    const cleanup = () => {
      window.clearTimeout(timer)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
    }
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('error', onError)
    video.currentTime = time
  })
}

/** 解析する時刻の一覧（0秒から sampleFps 間隔、終端は含まない） */
export function sampleTimes(duration: number, fps: number = ANALYSIS.sampleFps): number[] {
  const n = Math.ceil(duration * fps)
  return Array.from({ length: n }, (_, i) => i / fps)
}
