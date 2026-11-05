// 選んだクリップを写真アプリに保存する。
// 共有シートはタップ直後にしか開けないため、選んだクリップを裏で先に書き出しておき、
// 「写真に保存」のタップで書き出し済みのファイルをすぐ共有シートに渡す（1タップで保存できるように）。
// メモリ上限に備えて推定サイズで何回かに分け、回ごとに書き出し済みにして保存する
import { useEffect, useMemo, useRef, useState } from 'react'
import { EXPORT } from '../config'
import { estimateClipBytes, planBatches, type NumberedClip } from '../export/batch'
import { UserFacingError } from '../video/videoFile'
import type { SelectedVideo } from '../App'
import { keepScreenAwake, saveFiles } from './browser'
import { formatDuration } from './labels'
import type { ExporterQueue } from './useClipExporter'

interface Props {
  video: SelectedVideo
  /** 動画の長さ（秒） */
  duration: number
  /** 保存するクリップ（number は区間の連番。ファイル名に使う） */
  chosen: NumberedClip[]
  exporter: ExporterQueue
  /** 保存（共有シート）の途中か（途中は選択などを変えさせない） */
  onBusyChange: (busy: boolean) => void
  /** 保存を始める直前に呼ぶ（プレビューを止めるなど） */
  onBeforeStart: () => void
}

/** 書き出したファイルを見分けるキー（連番が変わるとファイル名も変わるので含める） */
const fileKey = (c: NumberedClip) => `${c.number}:${c.clip.start}-${c.clip.end}`

type Status = { kind: 'saved'; count: number; all: boolean } | { kind: 'cancelled' } | { kind: 'error'; message: string }

const MB = 1024 * 1024

export function ClipSaver({ video, duration, chosen, exporter, onBusyChange, onBeforeStart }: Props) {
  const batches = useMemo(
    () => planBatches(chosen, video.file.size, duration, EXPORT.maxBatchBytes),
    [chosen, video.file.size, duration],
  )
  // 選び方が変わったら、保存の回数も最初からにする
  const signature = batches.map((b) => b.map(fileKey).join(',')).join('|')
  const [progress, setProgress] = useState({ signature: '', round: 0, saved: 0, done: false })
  const current = progress.signature === signature ? progress : { signature, round: 0, saved: 0, done: false }
  const target = useMemo(() => batches[current.round] ?? [], [batches, current.round])
  const targetSignature = target.map(fileKey).join(',')

  const [status, setStatus] = useState<{ signature: string; status: Status } | null>(null)
  const shownStatus = status?.signature === signature ? status.status : null
  const [prepareError, setPrepareError] = useState<{ signature: string; message: string } | null>(null)
  const shownPrepareError = prepareError?.signature === targetSignature ? prepareError.message : null
  const [retry, setRetry] = useState(0)
  const [busy, setBusy] = useState(false)

  /** 書き出し済みのファイル（いま保存する回のものだけを持つ）。裏の書き出し処理からは ref で最新を読む */
  const [prepared, setPrepared] = useState<ReadonlyMap<string, File>>(new Map())
  const preparedRef = useRef<ReadonlyMap<string, File>>(prepared)
  const wantedRef = useRef<ReadonlySet<string>>(new Set())
  /** 要らなくなったファイルを手放して（メモリを空ける）、必要なら1つ加える */
  const updatePrepared = (add?: [string, File]) => {
    const next = new Map([...preparedRef.current].filter(([k]) => wantedRef.current.has(k)))
    if (add) next.set(...add)
    preparedRef.current = next
    setPrepared(next)
  }

  useEffect(() => onBusyChange(busy), [busy, onBusyChange])

  // いま保存する回のクリップを裏で書き出しておく。選び直しが続くあいだは待ち、落ち着いてから始める
  useEffect(() => {
    wantedRef.current = new Set(target.map(fileKey))
    let cancelled = false
    let releaseWakeLock: (() => void) | null = null
    const timer = window.setTimeout(async () => {
      updatePrepared()
      if (target.every((c) => preparedRef.current.has(fileKey(c)))) return
      // 書き出し中に画面が消えると止まるので、スリープを防ぐ
      releaseWakeLock = await keepScreenAwake()
      try {
        for (const c of target) {
          if (cancelled) return
          const key = fileKey(c)
          if (preparedRef.current.has(key)) continue
          try {
            const file = await exporter.run((ex) =>
              cancelled || preparedRef.current.has(key) ? Promise.resolve(null) : ex.exportClip(c.clip, c.number),
            )
            // 途中で選び直されても、まだ使うクリップなら書き出した結果を使う
            if (file && wantedRef.current.has(key)) updatePrepared([key, file])
          } catch (e) {
            if (cancelled) return
            console.error(e)
            const message = e instanceof UserFacingError ? e.message : `書き出し中にエラーが起きました（${String(e)}）`
            setPrepareError({ signature: targetSignature, message })
            return
          }
        }
        // 書き終えたら ffmpeg.wasm を終了してメモリを空ける（書き出したファイルは保存まで持つ）
        if (!cancelled) exporter.release()
      } finally {
        releaseWakeLock?.()
        releaseWakeLock = null
      }
    }, EXPORT.prepareDelayMs)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      releaseWakeLock?.()
      releaseWakeLock = null
    }
    // updatePrepared は ref だけを読み書きするので、作り直されても再実行は要らない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, targetSignature, exporter, retry])

  const preparedCount = target.filter((c) => prepared.has(fileKey(c))).length
  const ready = target.length > 0 && preparedCount === target.length

  const chosenSec = chosen.reduce((s, c) => s + (c.clip.end - c.clip.start), 0)
  const chosenBytes = chosen.reduce((s, c) => s + estimateClipBytes(c.clip, video.file.size, duration), 0)
  const multiRound = batches.length > 1
  const roundLabel = multiRound ? `・${current.round + 1}/${batches.length}回目` : ''

  // 共有シートはタップ直後にしか開けないため、ボタンのクリックから待たずに呼ぶ
  const save = async () => {
    if (!ready || busy) return
    const files = target.map((c) => prepared.get(fileKey(c))!)
    onBeforeStart()
    setBusy(true)
    try {
      const result = await saveFiles(files)
      if (result === 'cancelled') {
        setStatus({ signature, status: { kind: 'cancelled' } })
        return
      }
      const saved = current.saved + files.length
      const isLast = current.round + 1 >= batches.length
      setProgress({ signature, round: isLast ? current.round : current.round + 1, saved, done: isLast })
      setStatus({ signature, status: { kind: 'saved', count: isLast ? saved : files.length, all: isLast } })
    } catch (e) {
      console.error(e)
      setStatus({ signature, status: { kind: 'error', message: `保存に失敗しました（${String(e)}）` } })
    } finally {
      setBusy(false)
    }
  }

  // 共有シートをキャンセルした回を飛ばす（分けて保存するときだけ）
  const skipRound = () => {
    const isLast = current.round + 1 >= batches.length
    setProgress({ signature, round: isLast ? current.round : current.round + 1, saved: current.saved, done: isLast })
    setStatus(isLast ? { signature, status: { kind: 'saved', count: current.saved, all: true } } : null)
  }

  const restart = () => {
    setProgress({ signature, round: 0, saved: 0, done: false })
    setStatus(null)
  }

  return (
    <div className="actions">
      <p className="summary" aria-live="polite">
        {chosen.length}本を選択（合計 {formatDuration(chosenSec)}・約{Math.round(chosenBytes / MB)}MB）
      </p>
      {multiRound && !current.done && (
        <p className="hint">メモリ不足を防ぐため、{batches.length}回に分けて保存します。</p>
      )}
      {shownStatus?.kind === 'saved' && (
        <p className="message success">
          {shownStatus.all ? `${shownStatus.count}本を保存しました。` : `${shownStatus.count}本を保存しました。続きを保存してください。`}
        </p>
      )}
      {shownStatus?.kind === 'cancelled' && <p className="message warning">保存をキャンセルしました。</p>}
      {shownStatus?.kind === 'cancelled' && multiRound && !current.done && (
        <button className="button secondary" onClick={skipRound} disabled={busy}>
          {current.round + 1 >= batches.length ? '保存せずに終わる' : 'この回は保存せずに次へ進む'}
        </button>
      )}
      {shownStatus?.kind === 'error' && <p className="message error">{shownStatus.message}</p>}
      {shownPrepareError && (
        <>
          <p className="message error">{shownPrepareError}</p>
          <button className="button secondary" onClick={() => {
              setPrepareError(null)
              setRetry((r) => r + 1)
            }}>
            もう一度準備する
          </button>
        </>
      )}
      {multiRound && current.done ? (
        <button className="button secondary" onClick={restart}>
          最初からもう一度保存する
        </button>
      ) : (
        <button className="button primary" onClick={save} disabled={!ready || busy}>
          {chosen.length === 0
            ? '保存するクリップを選んでください'
            : ready
              ? `写真に保存（${target.length}本${roundLabel}）`
              : `保存の準備中…（${preparedCount}/${target.length}本${roundLabel}）`}
        </button>
      )}
    </div>
  )
}
