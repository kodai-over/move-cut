// 編集画面：上にプレビュー、すぐ下にタイムライン（コマの帯・動きの波形・区間の帯）。
// 区間の帯をタップで頭から再生、ダブルタップで残す／捨てる、選んだ帯の両端をドラッグして伸縮する。
// 書き出しは別画面。スライダー（AIの提案の作り直し）は設定シートに置く
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Interval } from '../analysis/segment'
import type { MotionSample } from '../analysis/types'
import { toCsv } from '../analysis/motion'
import { excludedIntervals, segmentMotion } from '../analysis/segment'
import { PREVIEW, SEGMENT_DEFAULTS, TIMELINE, type SegmentParams } from '../config'
import type { NumberedClip } from '../export/batch'
import { clipsFromIntervals, trimClip, type ClipEdge, type EditClip } from '../timeline/clips'
import type { FilmstripFrame } from '../video/analyzeVideo'
import type { SelectedVideo } from '../App'
import { baseName, downloadText } from './browser'
import { ExportScreen } from './ExportScreen'
import { Icon } from './icons'
import { Preview } from './Preview'
import { SettingsSheet } from './SettingsSheet'
import { Timeline } from './Timeline'
import { useClipExporter } from './useClipExporter'

interface Props {
  video: SelectedVideo
  samples: MotionSample[]
  duration: number
  filmstrip: FilmstripFrame[]
  frameAspect: number
  params: SegmentParams
  onChangeParams: (params: SegmentParams) => void
  onBack: () => void
}

export function EditScreen({ video, samples, duration, filmstrip, frameAspect, params, onChangeParams, onBack }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  /** 最後にシークを頼んだ時刻（初回の再生準備中に続けてシークされた場合も最新を使う） */
  const pendingSeekRef = useRef(0)
  /** クリップだけを再生中なら、そのクリップの番号（終わりで止める） */
  const [playingClipId, setPlayingClipId] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [view, setView] = useState<'edit' | 'export'>('edit')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [keyframes, setKeyframes] = useState<number[] | null>(null)
  /** シークのために無音で一瞬再生している間（再生中の扱いにしない） */
  const warmingUpRef = useRef(false)
  /** 書き出し画面で書き出したファイル（編集に戻っても、変えていないクリップは書き出し直さない） */
  const exportCacheRef = useRef<ReadonlyMap<string, File>>(new Map())

  // 解析はやり直さず、区間の計算だけをやり直す
  const { clips: intervals, freezes } = useMemo(
    () => segmentMotion(samples, duration, params, 'idea'),
    [samples, duration, params],
  )
  const excluded = useMemo(() => excludedIntervals(samples), [samples])
  /** 手で変えたクリップ（AIの提案が作り直されたら使わない） */
  const [edited, setEdited] = useState<{ source: Interval[]; clips: EditClip[] } | null>(null)
  const suggested = useMemo(() => clipsFromIntervals(intervals), [intervals])
  const clips = edited?.source === intervals ? edited.clips : suggested
  const setClips = (next: EditClip[]) => setEdited({ source: intervals, clips: next })

  const chosen: NumberedClip[] = useMemo(
    () => clips.flatMap((c, i) => (c.keep ? [{ number: i + 1, clip: c }] : [])),
    [clips],
  )

  // ffmpeg.wasm は1つだけ使い回し、キーフレームの読み取りと書き出しを順番に実行する
  const exporter = useClipExporter(video.file)

  // キーフレームの時刻を読む（開始のつまみの吸着用）。失敗したら、保存（共有シート）の後にもう一度試す
  const hasKeyframes = keyframes !== null
  useEffect(() => {
    if (hasKeyframes || busy) return
    let cancelled = false
    exporter
      .run((ex) => ex.keyframeTimes())
      .then((times) => !cancelled && setKeyframes(times))
      .catch((e) => {
        // 読めなくても編集・保存はできるので、吸着させないだけにする
        if (!cancelled) console.warn('キーフレームを読めませんでした', e)
      })
    return () => {
      cancelled = true
    }
  }, [exporter, hasKeyframes, busy])

  // 再生中は毎フレーム再生位置を読む（タイムラインを滑らかに流すため。timeupdate は間隔が粗い）。
  // クリップだけを再生しているときは、終わりで止める
  const playingClip = playingClipId === null ? null : (clips.find((c) => c.id === playingClipId) ?? null)
  const playingClipEnd = playingClip?.end ?? null
  useEffect(() => {
    if (!playing) return
    const el = videoRef.current
    if (!el) return
    const frame = { id: 0 }
    const tick = () => {
      if (playingClipEnd !== null && el.currentTime >= playingClipEnd) {
        el.pause()
        el.currentTime = playingClipEnd
        setCurrentTime(playingClipEnd)
        setPlayingClipId(null)
        return
      }
      setCurrentTime(el.currentTime)
      frame.id = requestAnimationFrame(tick)
    }
    frame.id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame.id)
  }, [playing, playingClipEnd])

  /** 動画だけをシークする（再生位置の状態は変えない） */
  const seekVideo = (time: number) => {
    const el = videoRef.current
    if (!el) return
    pendingSeekRef.current = time
    if (el.played.length > 0 || !el.paused) {
      el.currentTime = time
      return
    }
    // iOS Safari は一度も再生していない動画だと、シークしても表示中のコマが更新されない。
    // ユーザー操作の中で無音のまま一瞬再生して止め、描画できる状態にしてからシークする
    const wasMuted = el.muted
    el.muted = true
    // この再生で play イベントが出ても再生中にしない（再生位置が 0 に戻って見えるため）
    warmingUpRef.current = true
    el.play()
      .then(() => el.pause())
      .catch(() => {
        // 再生できない環境でも、シークだけは試みる
      })
      .finally(() => {
        warmingUpRef.current = false
        el.muted = wasMuted
        el.currentTime = pendingSeekRef.current
      })
  }

  const seek = (time: number) => {
    setCurrentTime(time)
    seekVideo(time)
  }

  const setPlayingIfReal = (next: boolean) => {
    if (!warmingUpRef.current) setPlaying(next)
  }

  /** タイムラインをなぞった：再生中なら止めてからシークする */
  const scrub = (time: number) => {
    if (playing) stop()
    seek(time)
  }

  const stop = () => {
    videoRef.current?.pause()
    setPlayingClipId(null)
  }

  const togglePlay = () => {
    const el = videoRef.current
    if (!el) return
    if (!el.paused) {
      stop()
      return
    }
    setPlayingClipId(null)
    if (el.ended || el.currentTime >= duration - PREVIEW.restartNearEndSec) el.currentTime = 0
    void el.play().catch(() => {})
  }

  const playClip = (id: number) => {
    const el = videoRef.current
    const clip = clips.find((c) => c.id === id)
    if (!el || !clip) return
    setSelectedId(id)
    el.currentTime = clip.start
    setCurrentTime(clip.start)
    setPlayingClipId(id)
    void el.play().catch(() => {
      // 再生できなくても、シーク位置の表示は試みる
    })
  }

  const toggleKeep = (id: number) => {
    setClips(clips.map((c) => (c.id === id ? { ...c, keep: !c.keep } : c)))
  }

  const setAll = (keep: boolean) => setClips(clips.map((c) => ({ ...c, keep })))

  // つまみのドラッグ。動かし始めたときのクリップを元に毎回計算する（縮め戻せば合体も元に戻る）
  const trimRef = useRef<{ snapshot: EditClip[]; id: number; edge: ClipEdge; time: number } | null>(null)
  const trimStart = (id: number, edge: ClipEdge) => {
    stop()
    const clip = clips.find((c) => c.id === id)
    if (!clip) return
    trimRef.current = { snapshot: clips, id, edge, time: edge === 'start' ? clip.start : clip.end }
  }
  const trim = (time: number) => {
    const t = trimRef.current
    if (!t) return
    const next = trimClip(t.snapshot, t.id, t.edge, time, { duration, minSec: TIMELINE.minClipSec, keyframes })
    const moved = next.find((c) => c.id === t.id)
    if (!moved) return
    setClips(next)
    // 動かしている端のコマをプレビューに出す（タイムラインは動かさない）
    const edgeTime = t.edge === 'start' ? moved.start : moved.end
    if (edgeTime !== t.time) {
      t.time = edgeTime
      seekVideo(edgeTime)
    }
  }
  const trimEnd = () => {
    const t = trimRef.current
    trimRef.current = null
    // 離したら、動かした端に再生位置を合わせる
    if (t) setCurrentTime(t.time)
  }

  // スライダーはAIの提案を作り直す。手で変えた内容があれば確かめてから捨てる
  const changeParams = (next: SegmentParams) => {
    const same = (Object.keys(next) as (keyof SegmentParams)[]).every((k) => next[k] === params[k])
    if (same) return
    if (edited?.source === intervals && !window.confirm('手で調整した内容が消えます。作り直しますか？')) return
    setEdited(null)
    setSelectedId(null)
    onChangeParams(next)
  }

  const exportCsv = () => downloadText(toCsv(samples), `${baseName(video.file.name)}_motion.csv`, 'text/csv')

  if (view === 'export') {
    return (
      <ExportScreen
        video={video}
        duration={duration}
        chosen={chosen}
        filmstrip={filmstrip}
        frameAspect={frameAspect}
        exporter={exporter}
        cacheRef={exportCacheRef}
        busy={busy}
        onBusyChange={setBusy}
        onBack={() => setView('edit')}
      />
    )
  }

  return (
    <section className="editor">
      <Preview
        videoRef={videoRef}
        src={video.url}
        currentTime={currentTime}
        duration={duration}
        playing={playing}
        onTogglePlay={togglePlay}
        onPlayingChange={setPlayingIfReal}
        onLoaded={() => {
          if (currentTime > 0) seekVideo(currentTime)
        }}
      >
        <div className="bar overlay">
          <button type="button" className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="設定" title="設定">
            <Icon name="sliders" />
          </button>
          <button
            type="button"
            className="pill"
            onClick={() => {
              stop()
              setView('export')
            }}
            disabled={chosen.length === 0}
            title={chosen.length === 0 ? '残すクリップがありません' : `残す${chosen.length}本を書き出す`}
          >
            書き出す
          </button>
        </div>
      </Preview>

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
          selectedId={selectedId}
          onScrub={scrub}
          onTapClip={playClip}
          onDoubleTapClip={toggleKeep}
          onTapEmpty={() => setSelectedId(null)}
          onTrimStart={trimStart}
          onTrim={trim}
          onTrimEnd={trimEnd}
        />
      )}

      {settingsOpen && (
        <SettingsSheet
          params={params}
          onChangeParams={changeParams}
          onResetParams={() => changeParams(SEGMENT_DEFAULTS.idea)}
          onSetAll={setAll}
          onExportCsv={exportCsv}
          onBack={onBack}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </section>
  )
}
