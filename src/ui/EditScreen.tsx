// 編集画面：上にプレビュー、下にタイムライン（コマの帯・動きの波形・区間の帯）。
// 区間ごとに残す／捨てるを選び、選んだクリップをまとめて保存する。スライダーはAIの提案を作り直すときに使う
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Mode, MotionSample } from '../analysis/types'
import { toCsv } from '../analysis/motion'
import { excludedIntervals, segmentMotion } from '../analysis/segment'
import { SEGMENT_DEFAULTS, type SegmentParams } from '../config'
import type { NumberedClip } from '../export/batch'
import type { FilmstripFrame } from '../video/analyzeVideo'
import type { SelectedVideo } from '../App'
import { baseName, downloadText } from './browser'
import { ClipSaver } from './ClipSaver'
import { MODE_LABEL, formatDuration } from './labels'
import { ParamSliders } from './ParamSliders'
import { Timeline } from './Timeline'

interface Props {
  video: SelectedVideo
  mode: Mode
  samples: MotionSample[]
  duration: number
  filmstrip: FilmstripFrame[]
  frameAspect: number
  params: SegmentParams
  onChangeParams: (params: SegmentParams) => void
  onBack: () => void
}

/** 区間を見分けるキー（区間が作り直されたら別のものとして扱う） */
const clipKey = (c: { start: number; end: number }) => `${c.start}-${c.end}`

export function EditScreen({ video, mode, samples, duration, filmstrip, frameAspect, params, onChangeParams, onBack }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [currentTime, setCurrentTime] = useState(0)
  /** 最後にタップされた時刻（初回の再生準備中に続けてタップされた場合も最新を使う） */
  const pendingSeekRef = useRef(0)
  /** クリップだけを再生中なら、そのクリップの番号（終わりで止める） */
  const [playingClip, setPlayingClip] = useState<number | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  /** 捨てると選んだクリップ（キーで持つので、区間が作り直されると全部「残す」に戻る） */
  const [discarded, setDiscarded] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [keyframes, setKeyframes] = useState<number[] | null>(null)

  // 解析はやり直さず、区間の計算だけをやり直す
  const { clips: intervals, freezes } = useMemo(
    () => segmentMotion(samples, duration, params, mode),
    [samples, duration, params, mode],
  )
  const excluded = useMemo(() => excludedIntervals(samples), [samples])
  const clips = useMemo(() => intervals.map((c) => ({ ...c, keep: !discarded.has(clipKey(c)) })), [intervals, discarded])
  const chosen: NumberedClip[] = clips.flatMap((c, i) => (c.keep ? [{ number: i + 1, clip: c }] : []))

  // キーフレームの時刻を読む（開始位置の吸着用。フェーズ6で使う。ここでは目盛りとして表示する）
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { createClipExporter } = await import('../video/clipExporter')
        const exporter = await createClipExporter(video.file)
        try {
          const times = await exporter.keyframeTimes()
          if (!cancelled) setKeyframes(times)
        } finally {
          await exporter.dispose()
        }
      } catch (e) {
        // 読めなくても編集・保存はできるので、目盛りを出さないだけにする
        console.warn('キーフレームを読めませんでした', e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [video.file])

  // クリップだけを再生しているときは、終わりで止める（timeupdate は間隔が粗いので毎フレーム確かめる）
  useEffect(() => {
    if (playingClip === null) return
    const el = videoRef.current
    const clip = intervals[playingClip]
    if (!el || !clip) return
    const frame = { id: 0 }
    const check = () => {
      if (el.currentTime >= clip.end) {
        el.pause()
        setPlayingClip(null)
        return
      }
      frame.id = requestAnimationFrame(check)
    }
    frame.id = requestAnimationFrame(check)
    return () => cancelAnimationFrame(frame.id)
  }, [playingClip, intervals])

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

  const playClip = (i: number) => {
    const el = videoRef.current
    if (!el) return
    setSelected(i)
    el.currentTime = intervals[i].start
    setCurrentTime(intervals[i].start)
    setPlayingClip(i)
    void el.play().catch(() => {
      // 再生できなくても、シーク位置の表示は試みる
    })
  }

  const toggleKeep = (i: number) => {
    const key = clipKey(intervals[i])
    setDiscarded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const setAll = (keep: boolean) => setDiscarded(keep ? new Set() : new Set(intervals.map(clipKey)))

  const stopPreview = useCallback(() => {
    videoRef.current?.pause()
    setPlayingClip(null)
  }, [])

  const exportCsv = () => downloadText(toCsv(samples), `${baseName(video.file.name)}_motion.csv`, 'text/csv')
  const skeletonRatio = samples.length ? samples.filter((s) => s.source === 'skeleton').length / samples.length : 0

  return (
    <section className="screen edit">
      <video
        ref={videoRef}
        className="preview"
        src={video.url}
        controls
        playsInline
        preload="auto"
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onPause={() => setPlayingClip(null)}
      />
      <p className="meta">
        {video.file.name} ・ {MODE_LABEL[mode].title} ・ 骨格で判定 {Math.round(skeletonRatio * 100)}%
      </p>

      {samples.length === 0 ? (
        <p className="message error">解析結果が空です。別の動画でお試しください。</p>
      ) : (
        <Timeline
          duration={duration}
          samples={samples}
          filmstrip={filmstrip}
          frameAspect={frameAspect}
          clips={clips}
          freezes={freezes}
          excluded={excluded}
          startThreshold={params.startThreshold}
          endThreshold={params.endThreshold}
          keyframes={keyframes}
          currentTime={currentTime}
          selected={selected}
          onSeek={seek}
          onSelectClip={(i, time) => {
            setSelected(i)
            seek(time)
          }}
        />
      )}
      <p className="hint">
        区間の帯（青）をタップで選択、下の一覧でそのクリップだけを再生できます。オレンジはフリーズ、灰色は動きとして数えなかった時間。実線が開始閾値、破線が終了閾値です。
      </p>

      <div className="select-all">
        <span className="summary">クリップ {clips.length}本</span>
        <button type="button" className="button ghost" onClick={() => setAll(true)} disabled={busy}>
          すべて残す
        </button>
        <button type="button" className="button ghost" onClick={() => setAll(false)} disabled={busy}>
          すべて捨てる
        </button>
      </div>
      <ul className="clip-rows">
        {clips.map((c, i) => (
          <li key={clipKey(c)} className={`clip-row${c.keep ? ' keep' : ''}${selected === i ? ' selected' : ''}`}>
            <button type="button" className="clip-row-play" onClick={() => playClip(i)}>
              <span className="clip-title">
                {i + 1}. {formatDuration(c.start)}〜{formatDuration(c.end)}
              </span>
              <span className="clip-meta">{formatDuration(c.end - c.start)}{playingClip === i ? ' ・ 再生中' : ''}</span>
            </button>
            <label className="clip-check">
              <input type="checkbox" checked={c.keep} onChange={() => toggleKeep(i)} disabled={busy} />
              <span>{c.keep ? '残す' : '捨てる'}</span>
            </label>
          </li>
        ))}
      </ul>

      <ClipSaver video={video} duration={duration} chosen={chosen} onBusyChange={setBusy} onBeforeStart={stopPreview} />

      <details className="suggest-settings">
        <summary>AIの提案を調整する</summary>
        <ParamSliders
          params={params}
          showStillSec={mode === 'idea'}
          onChange={onChangeParams}
          onReset={() => onChangeParams(SEGMENT_DEFAULTS[mode])}
        />
      </details>

      <div className="actions">
        <button className="button secondary" onClick={exportCsv} disabled={samples.length === 0}>
          CSVを書き出す（デバッグ用）
        </button>
        <button className="button ghost" onClick={onBack} disabled={busy}>
          別の動画を選ぶ
        </button>
      </div>
    </section>
  )
}
