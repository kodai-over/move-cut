// 編集画面：上にプレビュー、すぐ下にタイムライン（コマの帯・動きの波形・区間の帯）。
// まとめて選んだ動画は、撮った順に1本のタイムラインにつなげる。プレビューは再生位置にある動画に切り替え、
// 動画の終わりまで再生したら次の動画を続けて再生する。解析が終わっていない動画は「解析中」と表示する。
// 区間の帯をタップで頭から再生、ダブルタップで残す／捨てる、選んだ帯の両端をドラッグして伸縮する（動画をまたいでは伸ばせない）。
// 書き出しは別画面。スライダー（AIの提案の作り直し）は設定シートに置く
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Interval } from '../analysis/segment'
import type { MotionSample } from '../analysis/types'
import { toCsv } from '../analysis/motion'
import { excludedIntervals, segmentMotion } from '../analysis/segment'
import { PREVIEW, SEGMENT_DEFAULTS, TIMELINE, type SegmentParams } from '../config'
import type { NumberedClip } from '../export/batch'
import { clipsFromIntervals, splitClip, trimClip, type ClipEdge, type EditClip } from '../timeline/clips'
import { globalClipId, locate, shiftIntervals, shiftTimes, sourceOffsets, splitClipId } from '../timeline/sources'
import type { FilmstripFrame } from '../video/analyzeVideo'
import type { AnalyzingProgress, SourceAnalysis, SourceVideo } from '../App'
import { baseName, downloadText } from './browser'
import { ExportScreen } from './ExportScreen'
import { Icon } from './icons'
import { Preview } from './Preview'
import { SettingsSheet } from './SettingsSheet'
import { Timeline, type PendingRange, type TimelineTool } from './Timeline'
import { useClipExporter } from './useClipExporter'

interface Props {
  sources: SourceVideo[]
  analyses: SourceAnalysis[]
  /** 裏で解析中の動画（なければ null） */
  analyzing: AnalyzingProgress | null
  params: SegmentParams
  onChangeParams: (params: SegmentParams) => void
  onBack: () => void
}

/** 手で変えたクリップ（動画ごと）。作ったときのパラメータと違えば（AIの提案を作り直したら）使わない */
interface Edits {
  params: SegmentParams
  bySource: ReadonlyMap<number, EditClip[]>
}

export function EditScreen({ sources, analyses, analyzing, params, onChangeParams, onBack }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  /** 再生位置（全体の時刻） */
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  /** プレビューに読み込んでいる動画 */
  const [active, setActive] = useState(0)
  /** 動画を切り替えたあと、読み込めたらシークする動画内の時刻と、続けて再生するか */
  const switchRef = useRef<{ local: number; play: boolean } | null>(null)
  /** 最後にシークを頼んだ動画内の時刻（初回の再生準備中に続けてシークされた場合も最新を使う） */
  const pendingSeekRef = useRef(0)
  /** クリップだけを再生中なら、そのクリップの番号（終わりで止める） */
  const [playingClipId, setPlayingClipId] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  /** 書き出し画面を開いたときの残すクリップ（開いている間に解析が終わっても変えない。分けて保存している途中で回がやり直しにならないように） */
  const [exportSnapshot, setExportSnapshot] = useState<{ chosen: NumberedClip[]; pendingCount: number } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** タイムラインの道具（選択／カット） */
  const [tool, setTool] = useState<TimelineTool>('select')
  /** 再生中になぞり始めたら、なぞり終えたときに再生を続ける */
  const resumeAfterScrubRef = useRef(false)
  const [busy, setBusy] = useState(false)
  /** 動画ごとのキーフレームの時刻（読めなかったら null。吸着させない） */
  const [keyframes, setKeyframes] = useState<ReadonlyMap<number, number[] | null>>(new Map())
  /** シークのために無音で一瞬再生している間（再生中の扱いにしない） */
  const warmingUpRef = useRef(false)
  /** 書き出し画面で書き出したファイル（編集に戻っても、変えていないクリップは書き出し直さない） */
  const exportCacheRef = useRef<ReadonlyMap<string, File>>(new Map())
  const [edits, setEdits] = useState<Edits | null>(null)

  const durations = useMemo(() => sources.map((s) => s.duration), [sources])
  const offsets = useMemo(() => sourceOffsets(durations), [durations])
  const total = durations.reduce((a, b) => a + b, 0)
  const last = sources.length - 1
  const results = useMemo(() => analyses.map((a) => (a.status === 'done' ? a.result : null)), [analyses])

  // 解析はやり直さず、区間の計算だけをやり直す（動画ごと）
  const segments = useMemo(
    () => results.map((r) => (r ? segmentMotion(r.samples, r.duration, params, 'idea') : null)),
    [results, params],
  )
  const suggested = useMemo(() => segments.map((s) => (s ? clipsFromIntervals(s.clips) : [])), [segments])
  const validEdits = edits?.params === params ? edits.bySource : null
  /** 動画ごとのクリップ（動画内の時刻） */
  const sourceClips = useMemo(
    () => suggested.map((clips, i) => validEdits?.get(i) ?? clips),
    [suggested, validEdits],
  )
  const setSourceClips = (updates: ReadonlyMap<number, EditClip[]>) =>
    setEdits((prev) => {
      const base = prev?.params === params ? prev.bySource : new Map<number, EditClip[]>()
      return { params, bySource: new Map([...base, ...updates]) }
    })

  // タイムラインに出すもの（全体の時刻）。スライダーで変わらないものは解析結果が増えたときだけ作り直す
  const timeline = useMemo(() => {
    const samples: MotionSample[] = []
    const filmstrip: FilmstripFrame[] = []
    const excluded: Interval[] = []
    const pending: PendingRange[] = []
    results.forEach((r, i) => {
      const offset = offsets[i]
      if (!r) {
        const a = analyses[i]
        const label = a.status === 'error' ? '解析できませんでした' : '解析中…'
        pending.push({ start: offset, end: offset + durations[i], label, title: a.status === 'error' ? a.message : undefined })
        return
      }
      samples.push(...shiftTimes(r.samples, offset))
      filmstrip.push(...shiftTimes(r.filmstrip, offset))
      excluded.push(...shiftIntervals(excludedIntervals(r.samples), offset))
    })
    return { samples, filmstrip, excluded, pending }
  }, [results, analyses, offsets, durations])
  const freezes = useMemo(
    () => segments.flatMap((s, i) => shiftIntervals(s?.freezes ?? [], offsets[i])),
    [segments, offsets],
  )
  const frameAspect = results.find((r) => r)?.frameAspect ?? 1
  const clips = useMemo(
    () =>
      sourceClips.flatMap((list, i) =>
        shiftIntervals(list, offsets[i]).map((c) => ({ ...c, id: globalClipId(i, c.id) })),
      ),
    [sourceClips, offsets],
  )
  const keyframeTicks = useMemo(
    () => [...keyframes].flatMap(([i, times]) => (times ? times.map((t) => t + offsets[i]) : [])).sort((a, b) => a - b),
    [keyframes, offsets],
  )

  const chosen: NumberedClip[] = useMemo(
    () =>
      sourceClips.flatMap((list, source) =>
        list.flatMap((c, i) => (c.keep ? [{ source, number: i + 1, clip: { start: c.start, end: c.end } }] : [])),
      ),
    [sourceClips],
  )

  // ffmpeg.wasm は1つだけ使い回し、キーフレームの読み取りと書き出しを順番に実行する
  const files = useMemo(() => sources.map((s) => s.file), [sources])
  const exporter = useClipExporter(files)

  // キーフレームの時刻を、解析が終わった動画から順に読む（開始のつまみの吸着用。クリップがない動画には要らない）。
  // 読み終えたら ffmpeg.wasm を終了してメモリを空ける
  const nextKeyframeSource = results.findIndex((r, i) => r !== null && !keyframes.has(i))
  useEffect(() => {
    if (busy) return
    if (nextKeyframeSource < 0) {
      exporter.release()
      return
    }
    const i = nextKeyframeSource
    const state = { cancelled: false }
    exporter
      .run((ex) => ex.keyframeTimes(i))
      .then((times) => !state.cancelled && setKeyframes((prev) => new Map(prev).set(i, times)))
      .catch((e) => {
        if (state.cancelled) return
        // 読めなくても編集・保存はできるので、吸着させないだけにする
        console.warn('キーフレームを読めませんでした', e)
        setKeyframes((prev) => new Map(prev).set(i, null))
      })
    return () => {
      state.cancelled = true
    }
  }, [exporter, nextKeyframeSource, busy])

  // 再生中は毎フレーム再生位置を読む（タイムラインを滑らかに流すため。timeupdate は間隔が粗い）。
  // クリップだけを再生しているときは、終わりで止める
  const playingClip = playingClipId === null ? null : (clips.find((c) => c.id === playingClipId) ?? null)
  const playingClipEnd = playingClip?.end ?? null
  const activeOffset = offsets[active] ?? 0
  useEffect(() => {
    if (!playing) return
    const el = videoRef.current
    if (!el) return
    const frame = { id: 0 }
    const tick = () => {
      const time = activeOffset + el.currentTime
      if (playingClipEnd !== null && time >= playingClipEnd) {
        el.pause()
        el.currentTime = playingClipEnd - activeOffset
        setCurrentTime(playingClipEnd)
        setPlayingClipId(null)
        return
      }
      setCurrentTime(time)
      frame.id = requestAnimationFrame(tick)
    }
    frame.id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame.id)
  }, [playing, playingClipEnd, activeOffset])

  /** プレビューを index 本目の動画に切り替え、読み込めたら local へシークする（play なら続けて再生する） */
  const switchTo = (index: number, local: number, play: boolean) => {
    switchRef.current = { local, play }
    // 読み込み直す間に毎フレームの読み取りが新しい動画の先頭の時刻を書き込まないよう、先に止める
    videoRef.current?.pause()
    setActive(index)
  }

  /** 動画だけをシークする（再生位置の状態は変えない）。time は動画内の時刻 */
  const seekVideo = (time: number) => {
    const el = videoRef.current
    if (!el) return
    pendingSeekRef.current = time
    if (el.played.length > 0 || !el.paused) {
      el.currentTime = time
      return
    }
    // iOS Safari は一度も再生していない動画だと、シークしても表示中のコマが更新されない。
    // 無音のまま一瞬再生して止め、描画できる状態にしてからシークする
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

  /** 全体の時刻へシークする（別の動画なら切り替える） */
  const seek = (time: number) => {
    setCurrentTime(time)
    const { index, local } = locate(time, offsets, durations)
    if (index !== active) switchTo(index, local, false)
    else seekVideo(local)
  }

  // 動画を読み込めたら、切り替えたときに頼まれた位置へシークする（書き出し画面から戻ったときは再生位置に戻す）
  const onLoaded = () => {
    const el = videoRef.current
    if (!el) return
    const request = switchRef.current
    switchRef.current = null
    const local = request?.local ?? currentTime - activeOffset
    if (request?.play) {
      el.currentTime = local
      // 再生中に次の動画へ切り替えたときは続けて再生する（断られたら止まったままにする）
      void el.play().catch(() => {})
    } else if (local > 0) {
      seekVideo(local)
    }
  }

  // 動画の終わりまで再生したら、次の動画を続けて再生する
  const onEnded = () => {
    // クリップだけを再生していたら、クリップの終わり（＝動画の終わり）で止める
    if (playingClipId !== null) {
      setPlayingClipId(null)
      setCurrentTime(offsets[active] + durations[active])
      return
    }
    if (active >= last) return
    setCurrentTime(offsets[active + 1])
    switchTo(active + 1, 0, true)
  }

  const setPlayingIfReal = (next: boolean) => {
    if (!warmingUpRef.current) setPlaying(next)
  }

  const stop = () => {
    videoRef.current?.pause()
    setPlayingClipId(null)
  }

  /** タイムラインをなぞった：再生中ならいったん止めてシークし、なぞり終えたら再生を続ける */
  const scrub = (time: number) => {
    if (playing) {
      resumeAfterScrubRef.current = true
      stop()
    }
    seek(time)
  }
  const scrubEnd = () => {
    if (!resumeAfterScrubRef.current) return
    resumeAfterScrubRef.current = false
    // 別の動画へ切り替えて読み込み中なら、読み込めたら再生する
    if (switchRef.current) {
      switchRef.current.play = true
      return
    }
    void videoRef.current?.play().catch(() => {})
  }

  const togglePlay = () => {
    const el = videoRef.current
    if (!el) return
    if (!el.paused) {
      stop()
      return
    }
    setPlayingClipId(null)
    // 最後まで再生し終えていたら、先頭から再生し直す
    if ((active === last && el.ended) || currentTime >= total - PREVIEW.restartNearEndSec) {
      setCurrentTime(0)
      if (active !== 0) {
        switchTo(0, 0, true)
        return
      }
      el.currentTime = 0
    }
    void el.play().catch(() => {})
  }

  const playClip = (id: number) => {
    const el = videoRef.current
    const clip = clips.find((c) => c.id === id)
    if (!el || !clip) return
    const { source } = splitClipId(id)
    setSelectedId(id)
    setCurrentTime(clip.start)
    setPlayingClipId(id)
    const local = clip.start - offsets[source]
    if (source !== active) {
      switchTo(source, local, true)
      return
    }
    el.currentTime = local
    void el.play().catch(() => {
      // 再生できなくても、シーク位置の表示は試みる
    })
  }

  // カットツール：タップした位置でクリップを2つに分ける（切る位置はキーフレームに吸着）
  const cutClip = (id: number, time: number) => {
    const { source, localId } = splitClipId(id)
    const limits = { duration: durations[source], minSec: TIMELINE.minClipSec, keyframes: keyframes.get(source) ?? null }
    const next = splitClip(sourceClips[source], localId, time - offsets[source], limits)
    if (next) setSourceClips(new Map([[source, next]]))
  }

  // キーボード：スペースで再生・停止、A で選択ツール、B でカットツール（Final Cut Pro と同じ）
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {})
  useEffect(() => {
    keyHandlerRef.current = (e) => {
      if (exportSnapshot || settingsOpen || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select')) return
      if (e.key === ' ') {
        e.preventDefault()
        togglePlay()
      } else if (e.key === 'a' || e.key === 'A') setTool('select')
      else if (e.key === 'b' || e.key === 'B') setTool('blade')
    }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandlerRef.current(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const toggleKeep = (id: number) => {
    const { source, localId } = splitClipId(id)
    const list = sourceClips[source]
    setSourceClips(new Map([[source, list.map((c) => (c.id === localId ? { ...c, keep: !c.keep } : c))]]))
  }

  // 解析中の動画には手を付けない（空のクリップで上書きすると、解析が終わっても区間が出なくなる）
  const setAll = (keep: boolean) =>
    setSourceClips(
      new Map(
        sourceClips.flatMap((list, i) => (results[i] ? [[i, list.map((c) => ({ ...c, keep }))] as const] : [])),
      ),
    )

  // つまみのドラッグ。動かし始めたときのクリップを元に毎回計算する（縮め戻せば合体も元に戻る）
  const trimRef = useRef<{ source: number; snapshot: EditClip[]; localId: number; edge: ClipEdge; time: number } | null>(
    null,
  )
  const trimStart = (id: number, edge: ClipEdge) => {
    stop()
    const { source, localId } = splitClipId(id)
    const clip = sourceClips[source]?.find((c) => c.id === localId)
    if (!clip) return
    trimRef.current = { source, snapshot: sourceClips[source], localId, edge, time: edge === 'start' ? clip.start : clip.end }
  }
  const trim = (time: number) => {
    const t = trimRef.current
    if (!t) return
    const limits = { duration: durations[t.source], minSec: TIMELINE.minClipSec, keyframes: keyframes.get(t.source) ?? null }
    const next = trimClip(t.snapshot, t.localId, t.edge, time - offsets[t.source], limits)
    const moved = next.find((c) => c.id === t.localId)
    if (!moved) return
    setSourceClips(new Map([[t.source, next]]))
    // 動かしている端のコマをプレビューに出す（タイムラインは動かさない）
    const edgeTime = t.edge === 'start' ? moved.start : moved.end
    if (edgeTime !== t.time) {
      t.time = edgeTime
      if (t.source === active) seekVideo(edgeTime)
      else switchTo(t.source, edgeTime, false)
    }
  }
  const trimEnd = () => {
    const t = trimRef.current
    trimRef.current = null
    // 離したら、動かした端に再生位置を合わせる
    if (t) setCurrentTime(offsets[t.source] + t.time)
  }

  // スライダーはAIの提案を作り直す。手で変えた内容があれば確かめてから捨てる
  const changeParams = (next: SegmentParams) => {
    const same = (Object.keys(next) as (keyof SegmentParams)[]).every((k) => next[k] === params[k])
    if (same) return
    if (validEdits && validEdits.size > 0 && !window.confirm('手で調整した内容が消えます。作り直しますか？')) return
    setEdits(null)
    setSelectedId(null)
    onChangeParams(next)
  }

  // CSV は再生位置にある動画のもの
  const activeResult = results[active]
  const exportCsv = () => {
    if (!activeResult) return
    downloadText(toCsv(activeResult.samples), `${baseName(sources[active].file.name)}_motion.csv`, 'text/csv')
  }

  const pendingCount = analyses.filter((a) => a.status === 'pending').length

  if (exportSnapshot) {
    return (
      <ExportScreen
        sources={sources}
        results={results}
        chosen={exportSnapshot.chosen}
        pendingCount={exportSnapshot.pendingCount}
        exporter={exporter}
        cacheRef={exportCacheRef}
        busy={busy}
        onBusyChange={setBusy}
        onBack={() => setExportSnapshot(null)}
      />
    )
  }

  return (
    <section className="editor">
      <Preview
        videoRef={videoRef}
        src={sources[active].url}
        currentTime={currentTime}
        duration={total}
        playing={playing}
        onTogglePlay={togglePlay}
        onPlayingChange={setPlayingIfReal}
        onLoaded={onLoaded}
        onEnded={onEnded}
      >
        <div className="bar overlay">
          <button type="button" className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="設定" title="設定">
            <Icon name="sliders" />
          </button>
          {analyzing && sources.length > 1 && (
            <span className="analyzing-pill" title="残りの動画を解析しています。終わった動画から編集できます">
              解析中 {analyzing.index + 1}/{sources.length}・{Math.floor(analyzing.progress * 100)}%
            </span>
          )}
          <button
            type="button"
            className="text-button"
            onClick={() => {
              stop()
              setExportSnapshot({ chosen, pendingCount })
            }}
            disabled={chosen.length === 0}
            title={chosen.length === 0 ? '残すクリップがありません' : `残す${chosen.length}本を書き出す`}
          >
            <Icon name="export" />
            書き出す
          </button>
        </div>
        <div className="tools" role="group" aria-label="道具">
          <button
            type="button"
            className={`icon-button${tool === 'select' ? ' active' : ''}`}
            onClick={() => setTool('select')}
            aria-pressed={tool === 'select'}
            aria-label="選択"
            title="選択（A）：帯のタップで再生、ダブルタップで残す／捨てる、両端のつまみで伸縮"
          >
            <Icon name="pointer" />
          </button>
          <button
            type="button"
            className={`icon-button${tool === 'blade' ? ' active' : ''}`}
            onClick={() => setTool('blade')}
            aria-pressed={tool === 'blade'}
            aria-label="カット"
            title="カット（B）：帯をタップした位置で2つに分ける"
          >
            <Icon name="scissors" />
          </button>
        </div>
      </Preview>

      <Timeline
        duration={total}
        samples={timeline.samples}
        filmstrip={timeline.filmstrip}
        frameAspect={frameAspect}
        clips={clips}
        freezes={freezes}
        excluded={timeline.excluded}
        pending={timeline.pending}
        boundaries={offsets.slice(1)}
        startThreshold={params.startThreshold}
        endThreshold={params.endThreshold}
        keyframes={keyframeTicks}
        currentTime={currentTime}
        selectedId={selectedId}
        onScrub={scrub}
        onTapClip={playClip}
        onDoubleTapClip={toggleKeep}
        onTapEmpty={() => {
          setSelectedId(null)
          togglePlay()
        }}
        onScrubEnd={scrubEnd}
        tool={tool}
        onCutClip={cutClip}
        onTrimStart={trimStart}
        onTrim={trim}
        onTrimEnd={trimEnd}
      />

      {settingsOpen && (
        <SettingsSheet
          params={params}
          onChangeParams={changeParams}
          onResetParams={() => changeParams(SEGMENT_DEFAULTS.idea)}
          onSetAll={setAll}
          onExportCsv={exportCsv}
          canExportCsv={activeResult !== null}
          onBack={onBack}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </section>
  )
}
