// 選んだクリップを写真アプリに保存する。
// 共有シートはタップ直後にしか開けないため、選んだクリップを裏で先に書き出しておき、
// 「写真に保存」のタップで書き出し済みのファイルをすぐ共有シートに渡す（1タップで保存できるように）。
// メモリ上限に備えて推定サイズで何回かに分け、回ごとに書き出し済みにして保存する
import { useEffect, useMemo, useRef, useState } from 'react'
import { EXPORT } from '../config'
import { estimateClipBytes, planBatches, type NumberedClip } from '../export/batch'
import { UserFacingError } from '../video/videoFile'
import type { SelectedVideo } from '../App'
import { saveFiles } from './browser'
import { formatDuration } from './labels'
import type { RunWithExporter } from './useClipExporter'

interface Props {
  video: SelectedVideo
  /** 動画の長さ（秒） */
  duration: number
  /** 保存するクリップ（number は区間の連番。ファイル名に使う） */
  chosen: NumberedClip[]
  run: RunWithExporter
  /** 保存（共有シート）の途中か（途中は選択などを変えさせない） */
  onBusyChange: (busy: boolean) => void
  /** 保存を始める直前に呼ぶ（プレビューを止めるなど） */
  onBeforeStart: () => void
}

/** 書き出したファイルを見分けるキー（連番が変わるとファイル名も変わるので含める） */
const fileKey = (c: NumberedClip) => `${c.number}:${c.clip.start}-${c.clip.end}`

type Status = { kind: 'saved'; count: number; all: boolean } | { kind: 'cancelled' } | { kind: 'error'; message: string }

const MB = 1024 * 1024

export function ClipSaver({ video, duration, chosen, run, onBusyChange, onBeforeStart }: Props) {
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

  /** 書き出し済みのファイル（いま保存する回のものだけを持つ）。描画のきっかけには version を使う */
  const preparedRef = useRef(new Map<string, File>())
  const [, setVersion] = useState(0)

  useEffect(() => onBusyChange(busy), [busy, onBusyChange])

  // いま保存する回のクリップを裏で書き出しておく。選び直しが続くあいだは待ち、落ち着いてから始める
  useEffect(() => {
    const keys = new Set(target.map(fileKey))
    // 要らなくなったファイルは手放してメモリを空ける
    for (const k of [...preparedRef.current.keys()]) if (!keys.has(k)) preparedRef.current.delete(k)
    setVersion((v) => v + 1)
    if (target.every((c) => preparedRef.current.has(fileKey(c)))) return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      for (const c of target) {
        const key = fileKey(c)
        if (cancelled) return
        if (preparedRef.current.has(key)) continue
        try {
          const file = await run((exporter) => (cancelled ? Promise.resolve(null) : exporter.exportClip(c.clip, c.number)))
          if (cancelled || !file) return
          preparedRef.current.set(key, file)
          setVersion((v) => v + 1)
        } catch (e) {
          if (cancelled) return
          console.error(e)
          const message = e instanceof UserFacingError ? e.message : `書き出し中にエラーが起きました（${String(e)}）`
          setPrepareError({ signature: targetSignature, message })
          return
        }
      }
    }, EXPORT.prepareDelayMs)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // target は targetSignature が同じなら中身も同じなので、targetSignature で再実行を判断する
  }, [targetSignature, run, retry])

  const preparedCount = target.filter((c) => preparedRef.current.has(fileKey(c))).length
  const ready = target.length > 0 && preparedCount === target.length

  const chosenSec = chosen.reduce((s, c) => s + (c.clip.end - c.clip.start), 0)
  const chosenBytes = chosen.reduce((s, c) => s + estimateClipBytes(c.clip, video.file.size, duration), 0)
  const multiRound = batches.length > 1
  const roundLabel = multiRound ? `・${current.round + 1}/${batches.length}回目` : ''

  // 共有シートはタップ直後にしか開けないため、ボタンのクリックから待たずに呼ぶ
  const save = async () => {
    if (!ready || busy) return
    const files = target.map((c) => preparedRef.current.get(fileKey(c))!)
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
