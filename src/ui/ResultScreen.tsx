// 解析結果画面：プレビュー動画、動きスコアのグラフと切り出し区間、パラメータ調整、CSV書き出し
import { useMemo, useRef, useState } from 'react'
import type { Mode, MotionSample } from '../analysis/types'
import { toCsv } from '../analysis/motion'
import { excludedIntervals, segmentMotion } from '../analysis/segment'
import { SEGMENT_DEFAULTS, type SegmentParams } from '../config'
import type { SelectedVideo } from '../App'
import { baseName, downloadText } from './browser'
import { MotionChart } from './MotionChart'
import { MODE_LABEL, formatDuration } from './labels'
import { ParamSliders } from './ParamSliders'
import { ExportCheck } from './ExportCheck'

interface Props {
  video: SelectedVideo
  mode: Mode
  samples: MotionSample[]
  /** 動画の長さ（秒）。区間の末尾をこの範囲に収める */
  duration: number
  onBack: () => void
}

export function ResultScreen({ video, mode, samples, duration, onBack }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [currentTime, setCurrentTime] = useState(0)
  /** 最後にタップされた時刻（初回の再生準備中に続けてタップされた場合も最新を使う） */
  const pendingSeekRef = useRef(0)
  const [params, setParams] = useState<SegmentParams>(SEGMENT_DEFAULTS[mode])
  // 解析はやり直さず、区間の計算だけをやり直す
  const { clips, freezes } = useMemo(() => segmentMotion(samples, duration, params, mode), [samples, duration, params, mode])
  const excluded = useMemo(() => excludedIntervals(samples), [samples])
  const totalSec = clips.reduce((sum, c) => sum + (c.end - c.start), 0)

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
        <MotionChart
          samples={samples}
          currentTime={currentTime}
          clips={clips}
          freezes={freezes}
          excluded={excluded}
          startThreshold={params.startThreshold}
          endThreshold={params.endThreshold}
          onSeek={seek}
        />
      )}
      <p className="hint">
        青い帯が切り出し区間、オレンジの帯がフリーズ、灰色の帯はカメラ付近などで動きとして数えなかった時間。実線が開始閾値、破線が終了閾値です。グラフをタップすると、その時刻にプレビューが移動します。
      </p>

      <p className="summary" aria-live="polite">
        切り出し区間 <strong>{clips.length}</strong> 個（合計 {formatDuration(totalSec)}）
      </p>
      {clips.length > 0 && (
        <ol className="clip-list">
          {clips.map((c, i) => (
            <li key={`${c.start}-${c.end}`}>
              <button type="button" className="clip-chip" onClick={() => seek(c.start)}>
                {i + 1}. {formatDuration(c.start)}〜{formatDuration(c.end)}
              </button>
            </li>
          ))}
        </ol>
      )}

      {clips.length > 0 && <ExportCheck source={video.file} clip={clips[0]} index={1} />}

      <ParamSliders params={params} onChange={setParams} onReset={() => setParams(SEGMENT_DEFAULTS[mode])} />

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
