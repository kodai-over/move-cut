// 解析結果画面：プレビュー動画と動きスコアのグラフ、CSV書き出し
import { useRef, useState } from 'react'
import type { Mode, MotionSample } from '../analysis/types'
import { toCsv } from '../analysis/motion'
import type { SelectedVideo } from '../App'
import { baseName, downloadText } from './browser'
import { MotionChart } from './MotionChart'
import { MODE_LABEL } from './labels'

interface Props {
  video: SelectedVideo
  mode: Mode
  samples: MotionSample[]
  onBack: () => void
}

export function ResultScreen({ video, mode, samples, onBack }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [currentTime, setCurrentTime] = useState(0)
  /** 最後にタップされた時刻（初回の再生準備中に続けてタップされた場合も最新を使う） */
  const pendingSeekRef = useRef(0)

  const seek = (time: number) => {
    const el = videoRef.current
    if (!el) return
    setCurrentTime(time)
    pendingSeekRef.current = time
    if (el.played.length > 0 || !el.paused) {
      el.currentTime = time
      return
    }
    // iOS Safari は一度も再生していない動画だと、シークしても表示中のコマが更新されない。
    // タップ（ユーザー操作）の中で無音のまま一瞬再生して止め、描画できる状態にしてからシークする
    const wasMuted = el.muted
    el.muted = true
    el.play()
      .then(() => el.pause())
      .catch(() => {
        // 再生できない環境でも、シークだけは試みる
      })
      .finally(() => {
        el.muted = wasMuted
        el.currentTime = pendingSeekRef.current
      })
  }

  const exportCsv = () => {
    downloadText(toCsv(samples), `${baseName(video.file.name)}_motion.csv`, 'text/csv')
  }

  const skeletonRatio = samples.length ? samples.filter((s) => s.source === 'skeleton').length / samples.length : 0

  return (
    <section className="screen result">
      <video
        ref={videoRef}
        className="preview"
        src={video.url}
        controls
        playsInline
        preload="auto"
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
      />

      <p className="meta">
        {video.file.name} ・ {MODE_LABEL[mode].title} ・ 骨格で判定 {Math.round(skeletonRatio * 100)}%
      </p>

      {samples.length === 0 ? (
        <p className="message error">解析結果が空です。別の動画でお試しください。</p>
      ) : (
        <MotionChart samples={samples} currentTime={currentTime} onSeek={seek} />
      )}
      <p className="hint">グラフをタップすると、その時刻にプレビューが移動します。</p>

      <div className="actions">
        <button className="button secondary" onClick={exportCsv} disabled={samples.length === 0}>
          CSVを書き出す（デバッグ用）
        </button>
        <button className="button ghost" onClick={onBack}>
          別の動画を選ぶ
        </button>
      </div>
    </section>
  )
}
