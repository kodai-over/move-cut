// クリップ一覧画面：サムネイル・開始時刻・長さを並べ、タップでプレビュー、チェックで残す／捨てるを選び、
// 選んだクリップを書き出して共有シート（写真アプリ）に保存する
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Interval } from '../analysis/segment'
import { EXPORT } from '../config'
import { estimateClipBytes, planBatches, type NumberedClip } from '../export/batch'
import type { ClipExporter } from '../video/clipExporter'
import { generateThumbnails } from '../video/thumbnails'
import { UserFacingError } from '../video/videoFile'
import type { SelectedVideo } from '../App'
import { keepScreenAwake, saveFiles } from './browser'
import { formatDuration } from './labels'

interface Props {
  video: SelectedVideo
  /** 動画の長さ（秒） */
  duration: number
  clips: Interval[]
  onBack: () => void
}

/** 書き出しの進み具合。batches は保存の回数ごとのクリップ */
type ExportState =
  | { step: 'idle' }
  | { step: 'exporting'; batches: NumberedClip[][]; batch: number; done: number; saved: number }
  | { step: 'ready'; batches: NumberedClip[][]; batch: number; files: File[]; cancelled: boolean; saved: number }
  | { step: 'finished'; saved: number }
  | { step: 'error'; message: string }

const MB = 1024 * 1024

export function ClipListScreen({ video, duration, clips, onBack }: Props) {
  const previewRef = useRef<HTMLVideoElement>(null)
  const [thumbs, setThumbs] = useState<(string | null)[]>(() => clips.map(() => null))
  const [selected, setSelected] = useState<boolean[]>(() => clips.map(() => true))
  const [playing, setPlaying] = useState<number | null>(null)
  const [state, setState] = useState<ExportState>({ step: 'idle' })
  const exporterRef = useRef<ClipExporter | null>(null)
  const releaseWakeLockRef = useRef<(() => void) | null>(null)
  /** サムネイル作成の中止用。書き出し中は4K動画のデコードが重ならないよう止める */
  const thumbsAbortRef = useRef<AbortController | null>(null)

  // サムネイルは余白の分だけ後ろのコマを使う（動き始めが写るように）
  useEffect(() => {
    const controller = new AbortController()
    thumbsAbortRef.current = controller
    const times = clips.map((c) => Math.min(c.start + EXPORT.thumbnailOffsetSec, c.end))
    void generateThumbnails(
      video.url,
      times,
      (i, url) => setThumbs((prev) => prev.map((t, k) => (k === i ? url : t))),
      controller.signal,
    )
    return () => controller.abort()
  }, [video.url, clips])

  // 画面を離れるときは書き出し用のワーカーとスリープ防止を片付ける
  useEffect(
    () => () => {
      void exporterRef.current?.dispose()
      exporterRef.current = null
      releaseWakeLockRef.current?.()
    },
    [],
  )

  const numbered: NumberedClip[] = useMemo(() => clips.map((clip, i) => ({ number: i + 1, clip })), [clips])
  const chosen = numbered.filter((_, i) => selected[i])
  const chosenSec = chosen.reduce((s, c) => s + (c.clip.end - c.clip.start), 0)
  const chosenBytes = chosen.reduce((s, c) => s + estimateClipBytes(c.clip, video.file.size, duration), 0)
  const plannedBatches = planBatches(chosen, video.file.size, duration, EXPORT.maxBatchBytes)
  const busy = state.step === 'exporting' || state.step === 'ready'

  const preview = (i: number) => {
    const el = previewRef.current
    if (!el) return
    el.currentTime = clips[i].start
    setPlaying(i)
    void el.play().catch(() => {
      // 再生できなくても、シーク位置の表示は試みる
    })
  }

  // クリップの終わりで止める。timeupdate は間隔が粗く行き過ぎるため、再生中は毎フレーム確かめる
  useEffect(() => {
    if (playing === null) return
    const el = previewRef.current
    if (!el) return
    const end = clips[playing].end
    const frame = { id: 0 }
    const check = () => {
      if (el.currentTime >= end) {
        el.pause()
        setPlaying(null)
        return
      }
      frame.id = requestAnimationFrame(check)
    }
    frame.id = requestAnimationFrame(check)
    return () => cancelAnimationFrame(frame.id)
  }, [playing, clips])

  const finish = (next: ExportState) => {
    void exporterRef.current?.dispose()
    exporterRef.current = null
    releaseWakeLockRef.current?.()
    releaseWakeLockRef.current = null
    setState(next)
  }

  const exportBatch = async (batches: NumberedClip[][], batch: number, saved: number) => {
    setState({ step: 'exporting', batches, batch, done: 0, saved })
    try {
      let exporter = exporterRef.current
      if (!exporter) {
        // ffmpeg.wasm は大きいので書き出し時に読み込む
        const { createClipExporter } = await import('../video/clipExporter')
        exporter = await createClipExporter(video.file)
        exporterRef.current = exporter
      }
      const files: File[] = []
      for (const c of batches[batch]) {
        // 画面を離れて片付けられたら終える
        if (exporterRef.current !== exporter) return
        files.push(await exporter.exportClip(c.clip, c.number))
        setState({ step: 'exporting', batches, batch, done: files.length, saved })
      }
      setState({ step: 'ready', batches, batch, files, cancelled: false, saved })
    } catch (e) {
      console.error(e)
      const message = e instanceof UserFacingError ? e.message : `書き出し中にエラーが起きました（${String(e)}）`
      finish({ step: 'error', message })
    }
  }

  const startExport = async () => {
    if (busy) return
    // 二度押しで書き出しが重ならないよう、待つ前に書き出し中へ切り替える
    setState({ step: 'exporting', batches: plannedBatches, batch: 0, done: 0, saved: 0 })
    previewRef.current?.pause()
    setPlaying(null)
    thumbsAbortRef.current?.abort()
    releaseWakeLockRef.current = await keepScreenAwake()
    await exportBatch(plannedBatches, 0, 0)
  }

  // 共有シートはタップ直後にしか開けないため、保存ボタンのクリックから直接呼ぶ
  const save = async () => {
    if (state.step !== 'ready') return
    const { batches, batch, files, saved } = state
    try {
      const result = await saveFiles(files)
      if (result === 'cancelled') {
        setState({ ...state, cancelled: true })
        return
      }
    } catch (e) {
      console.error(e)
      finish({ step: 'error', message: `保存に失敗しました（${String(e)}）` })
      return
    }
    goNext(batches, batch, saved + files.length)
  }

  const goNext = (batches: NumberedClip[][], batch: number, saved: number) => {
    if (batch + 1 < batches.length) {
      void exportBatch(batches, batch + 1, saved)
    } else {
      finish({ step: 'finished', saved })
    }
  }

  const toggle = (i: number) => setSelected((prev) => prev.map((v, k) => (k === i ? !v : v)))
  const setAll = (value: boolean) => setSelected(clips.map(() => value))

  return (
    <section className="screen clips">
      <video
        ref={previewRef}
        className="preview"
        src={video.url}
        controls
        playsInline
        preload="metadata"
        onPause={() => setPlaying(null)}
      />
      <p className="hint">クリップをタップするとプレビューします。残すクリップにチェックを付けてください。</p>

      <div className="select-all">
        <button type="button" className="button ghost" onClick={() => setAll(true)} disabled={busy}>
          すべて選ぶ
        </button>
        <button type="button" className="button ghost" onClick={() => setAll(false)} disabled={busy}>
          すべて外す
        </button>
      </div>

      <ul className="clip-cards">
        {clips.map((c, i) => (
          <li key={`${c.start}-${c.end}`} className={`clip-card${selected[i] ? ' selected' : ''}${playing === i ? ' playing' : ''}`}>
            <button type="button" className="clip-thumb" onClick={() => preview(i)} aria-label={`クリップ${i + 1}をプレビュー`}>
              {thumbs[i] ? <img src={thumbs[i]!} alt="" /> : <span className="thumb-placeholder" />}
            </button>
            <button type="button" className="clip-info" onClick={() => preview(i)}>
              <span className="clip-title">
                {i + 1}. {formatDuration(c.start)}〜
              </span>
              <span className="clip-meta">
                {formatDuration(c.end - c.start)} ・ 約{Math.round(estimateClipBytes(c, video.file.size, duration) / MB)}MB
              </span>
            </button>
            <label className="clip-check">
              <input type="checkbox" checked={selected[i]} onChange={() => toggle(i)} disabled={busy} />
              <span>{selected[i] ? '残す' : '捨てる'}</span>
            </label>
          </li>
        ))}
      </ul>

      <p className="summary" aria-live="polite">
        {chosen.length}本を選択（合計 {formatDuration(chosenSec)}・約{Math.round(chosenBytes / MB)}MB）
      </p>
      {plannedBatches.length > 1 && state.step === 'idle' && (
        <p className="hint">メモリ不足を防ぐため、{plannedBatches.length}回に分けて保存します。</p>
      )}

      <ExportPanel state={state} chosenCount={chosen.length} onStart={startExport} onSave={save} onSkip={goNext} />

      <button type="button" className="button ghost" onClick={onBack} disabled={busy}>
        解析結果に戻る
      </button>
    </section>
  )
}

interface PanelProps {
  state: ExportState
  chosenCount: number
  onStart: () => void
  onSave: () => void
  onSkip: (batches: NumberedClip[][], batch: number, saved: number) => void
}

/** 書き出し・保存のボタンと進み具合 */
function ExportPanel({ state, chosenCount, onStart, onSave, onSkip }: PanelProps) {
  switch (state.step) {
    case 'idle':
    case 'finished':
    case 'error':
      return (
        <div className="actions">
          {state.step === 'finished' && <p className="message success">{state.saved}本を保存しました。</p>}
          {state.step === 'error' && <p className="message error">{state.message}</p>}
          <button className="button primary" onClick={onStart} disabled={chosenCount === 0}>
            選択したクリップを保存（{chosenCount}本）
          </button>
        </div>
      )
    case 'exporting': {
      const round = state.batches.length > 1 ? `${state.batch + 1}/${state.batches.length}回目：` : ''
      return (
        <p className="message warning" aria-live="polite">
          {round}書き出し中 {state.done}/{state.batches[state.batch].length}本（画面を閉じないでください）
        </p>
      )
    }
    case 'ready': {
      const round = state.batches.length > 1 ? `（${state.batch + 1}/${state.batches.length}回目）` : ''
      const isLast = state.batch + 1 >= state.batches.length
      return (
        <div className="actions">
          <p className="meta">
            {state.files.length}本を書き出しました{round}。共有シートの「ビデオを保存」で写真アプリに保存できます。
          </p>
          {state.cancelled && <p className="message warning">保存をキャンセルしました。もう一度保存するか、次へ進めます。</p>}
          <button className="button primary" onClick={onSave}>
            写真に保存する（{state.files.length}本）
          </button>
          {state.cancelled && (
            <button className="button secondary" onClick={() => onSkip(state.batches, state.batch, state.saved)}>
              {isLast ? '保存せずに終わる' : '保存せずに次へ進む'}
            </button>
          )}
        </div>
      )
    }
  }
}
