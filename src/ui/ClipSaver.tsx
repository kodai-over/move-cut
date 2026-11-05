// 選んだクリップを書き出して、共有シート（写真アプリ）に保存する。
// メモリ上限に備えて推定サイズで何回かに分け、回ごとに書き出し →「写真に保存する」を繰り返す
import { useEffect, useRef, useState } from 'react'
import { EXPORT } from '../config'
import { estimateClipBytes, planBatches, type NumberedClip } from '../export/batch'
import type { ClipExporter } from '../video/clipExporter'
import { UserFacingError } from '../video/videoFile'
import type { SelectedVideo } from '../App'
import { keepScreenAwake, saveFiles } from './browser'
import { formatDuration } from './labels'

interface Props {
  video: SelectedVideo
  /** 動画の長さ（秒） */
  duration: number
  /** 保存するクリップ（number は一覧での連番。ファイル名に使う） */
  chosen: NumberedClip[]
  /** 書き出し・保存の途中か（途中は選択などを変えさせない） */
  onBusyChange: (busy: boolean) => void
  /** 書き出しを始める直前に呼ぶ（プレビューを止めるなど） */
  onBeforeStart: () => void
}

type State =
  | { step: 'idle' }
  | { step: 'exporting'; batches: NumberedClip[][]; batch: number; done: number; saved: number }
  | { step: 'ready'; batches: NumberedClip[][]; batch: number; files: File[]; cancelled: boolean; saved: number }
  | { step: 'finished'; saved: number }
  | { step: 'error'; message: string }

const MB = 1024 * 1024

export function ClipSaver({ video, duration, chosen, onBusyChange, onBeforeStart }: Props) {
  const [state, setState] = useState<State>({ step: 'idle' })
  const exporterRef = useRef<ClipExporter | null>(null)
  const releaseWakeLockRef = useRef<(() => void) | null>(null)
  const busy = state.step === 'exporting' || state.step === 'ready'

  useEffect(() => onBusyChange(busy), [busy, onBusyChange])

  // 画面を離れるときは書き出し用のワーカーとスリープ防止を片付ける
  useEffect(
    () => () => {
      void exporterRef.current?.dispose()
      exporterRef.current = null
      releaseWakeLockRef.current?.()
    },
    [],
  )

  const chosenSec = chosen.reduce((s, c) => s + (c.clip.end - c.clip.start), 0)
  const chosenBytes = chosen.reduce((s, c) => s + estimateClipBytes(c.clip, video.file.size, duration), 0)
  const plannedBatches = planBatches(chosen, video.file.size, duration, EXPORT.maxBatchBytes)

  const finish = (next: State) => {
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

  const start = async () => {
    if (busy) return
    // 二度押しで書き出しが重ならないよう、待つ前に書き出し中へ切り替える
    setState({ step: 'exporting', batches: plannedBatches, batch: 0, done: 0, saved: 0 })
    onBeforeStart()
    releaseWakeLockRef.current = await keepScreenAwake()
    await exportBatch(plannedBatches, 0, 0)
  }

  const goNext = (batches: NumberedClip[][], batch: number, saved: number) => {
    if (batch + 1 < batches.length) void exportBatch(batches, batch + 1, saved)
    else finish({ step: 'finished', saved })
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

  return (
    <div className="actions">
      <p className="summary" aria-live="polite">
        {chosen.length}本を選択（合計 {formatDuration(chosenSec)}・約{Math.round(chosenBytes / MB)}MB）
      </p>
      {plannedBatches.length > 1 && state.step === 'idle' && (
        <p className="hint">メモリ不足を防ぐため、{plannedBatches.length}回に分けて保存します。</p>
      )}
      {(() => {
        switch (state.step) {
          case 'idle':
          case 'finished':
          case 'error':
            return (
              <>
                {state.step === 'finished' && <p className="message success">{state.saved}本を保存しました。</p>}
                {state.step === 'error' && <p className="message error">{state.message}</p>}
                <button className="button primary" onClick={start} disabled={chosen.length === 0}>
                  選択したクリップを保存（{chosen.length}本）
                </button>
              </>
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
              <>
                <p className="meta">
                  {state.files.length}本を書き出しました{round}。共有シートの「ビデオを保存」で写真アプリに保存できます。
                </p>
                {state.cancelled && (
                  <p className="message warning">保存をキャンセルしました。もう一度保存するか、次へ進めます。</p>
                )}
                <button className="button primary" onClick={save}>
                  写真に保存する（{state.files.length}本）
                </button>
                {state.cancelled && (
                  <button className="button secondary" onClick={() => goNext(state.batches, state.batch, state.saved)}>
                    {isLast ? '保存せずに終わる' : '保存せずに次へ進む'}
                  </button>
                )}
              </>
            )
          }
        }
      })()}
    </div>
  )
}
