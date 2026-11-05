// フェーズ3の最初の動作確認：区間を1つ書き出して保存できるか（iPhoneの4K動画で検証する）。
// クリップ一覧画面を作るまでの仮のUI
import { useState } from 'react'
import type { Interval } from '../analysis/segment'
import type { ClipExporter } from '../video/clipExporter'
import { UserFacingError } from '../video/videoFile'
import { keepScreenAwake, saveFiles } from './browser'
import { formatDuration } from './labels'

interface Props {
  source: File
  clip: Interval
  index: number
}

type State =
  | { step: 'idle' }
  | { step: 'exporting' }
  | { step: 'ready'; file: File; elapsedSec: number }
  | { step: 'error'; message: string }

const MB = 1024 * 1024

export function ExportCheck({ source, clip, index }: Props) {
  const [state, setState] = useState<State>({ step: 'idle' })
  const [saveResult, setSaveResult] = useState<string | null>(null)

  const exportClip = async () => {
    setState({ step: 'exporting' })
    setSaveResult(null)
    const release = await keepScreenAwake()
    const startedAt = performance.now()
    let exporter: ClipExporter | null = null
    try {
      // ffmpeg.wasm は大きいので書き出し時に読み込む
      const { createClipExporter } = await import('../video/clipExporter')
      exporter = await createClipExporter(source)
      const file = await exporter.exportClip(clip, index)
      setState({ step: 'ready', file, elapsedSec: (performance.now() - startedAt) / 1000 })
    } catch (e) {
      console.error(e)
      const message = e instanceof UserFacingError ? e.message : `書き出し中にエラーが起きました（${String(e)}）`
      setState({ step: 'error', message })
    } finally {
      await exporter?.dispose()
      release()
    }
  }

  const save = async (file: File) => {
    try {
      const result = await saveFiles([file])
      setSaveResult(
        result === 'shared' ? '共有シートで渡しました' : result === 'downloaded' ? 'ダウンロードしました' : 'キャンセルしました',
      )
    } catch (e) {
      console.error(e)
      setSaveResult(`保存に失敗しました（${String(e)}）`)
    }
  }

  return (
    <section className="export-check">
      <p className="hint">
        動作確認：区間{index}（{formatDuration(clip.start)}〜{formatDuration(clip.end)}）を書き出して、写真アプリに保存できるか試します。
      </p>
      {state.step === 'exporting' ? (
        <p className="message warning" aria-live="polite">
          書き出し中…（画面を閉じないでください）
        </p>
      ) : (
        <button className="button secondary" onClick={exportClip}>
          区間{index}を書き出す（動作確認）
        </button>
      )}
      {state.step === 'error' && <p className="message error">{state.message}</p>}
      {state.step === 'ready' && (
        <>
          <p className="meta">
            {state.file.name} ・ {(state.file.size / MB).toFixed(1)}MB ・ {state.elapsedSec.toFixed(1)}秒で書き出し
          </p>
          <button className="button primary" onClick={() => save(state.file)}>
            写真に保存する
          </button>
        </>
      )}
      {saveResult && <p className="meta">{saveResult}</p>}
    </section>
  )
}
