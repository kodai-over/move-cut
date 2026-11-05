// 動画選択画面：動画を1本選び、モードを選んで解析を始める
import { useEffect, useState } from 'react'
import type { Mode } from '../analysis/types'
import type { SelectedVideo } from '../App'
import { MODE_LABEL, formatDuration } from './labels'
import { createVideoElement, loadVideoInfo, supportWarnings, UserFacingError, type VideoInfo } from '../video/videoFile'

interface Props {
  video: SelectedVideo | null
  mode: Mode
  error?: string
  onSelectFile: (file: File | null) => void
  onChangeMode: (mode: Mode) => void
  onStart: () => void
}

type InfoState = { status: 'idle' } | { status: 'loading' } | { status: 'ok'; info: VideoInfo } | { status: 'error'; message: string }
type LoadResult = { url: string } & ({ status: 'ok'; info: VideoInfo } | { status: 'error'; message: string })

export function SelectScreen({ video, mode, error, onSelectFile, onChangeMode, onStart }: Props) {
  const [loaded, setLoaded] = useState<LoadResult | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)

  // 選んだ動画のメタデータを読み、非対応形式やサポート範囲外を事前に知らせる
  useEffect(() => {
    if (!video) return
    const url = video.url
    let cancelled = false
    const el = createVideoElement(url)
    loadVideoInfo(el)
      .then((info) => !cancelled && setLoaded({ url, status: 'ok', info }))
      .catch((e) => {
        if (cancelled) return
        const message = e instanceof UserFacingError ? e.message : '動画を読み込めませんでした。'
        setLoaded({ url, status: 'error', message })
      })
    return () => {
      cancelled = true
      el.removeAttribute('src')
      el.load()
    }
  }, [video])

  const info: InfoState = !video
    ? { status: 'idle' }
    : loaded?.url === video.url
      ? loaded
      : { status: 'loading' }
  const warnings = info.status === 'ok' ? supportWarnings(info.info) : []

  const handleFile = (file: File | undefined) => {
    // type が空の場合は判定できないので、読み込みを試して判断する
    if (file && file.type !== '' && !file.type.startsWith('video/')) {
      onSelectFile(null)
      setFileError('動画ファイルを選んでください。')
      return
    }
    setFileError(null)
    onSelectFile(file ?? null)
  }

  const handleStart = () => {
    if (warnings.length > 0) {
      const ok = window.confirm(
        `${warnings.join('\n')}\n正式サポート外のため、解析が遅い・途中で止まる可能性があります。続けますか？`,
      )
      if (!ok) return
    }
    onStart()
  }

  return (
    <section className="screen">
      <label className="file-picker">
        <input type="file" accept="video/*" onChange={(e) => handleFile(e.target.files?.[0])} />
        <span className="button secondary">{video ? '動画を選び直す' : '動画を選ぶ'}</span>
        <span className="file-name">{video ? video.file.name : 'まだ選ばれていません'}</span>
      </label>

      {info.status === 'ok' && (
        <p className="meta">
          {formatDuration(info.info.duration)} ・ {info.info.width}×{info.info.height}
        </p>
      )}
      {info.status === 'loading' && <p className="meta">動画を読み込み中…</p>}
      {info.status === 'error' && <p className="message error">{info.message}</p>}
      {fileError && <p className="message error">{fileError}</p>}
      {warnings.length > 0 && <p className="message warning">{warnings.join(' ')}正式サポート外です。</p>}

      <fieldset className="modes">
        <legend>モード</legend>
        {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
          <label key={m} className={`mode ${mode === m ? 'selected' : ''}`}>
            <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => onChangeMode(m)} />
            <span className="mode-title">{MODE_LABEL[m].title}</span>
            <span className="mode-note">{MODE_LABEL[m].note}</span>
          </label>
        ))}
      </fieldset>

      {error && <p className="message error">{error}</p>}

      <button className="button primary" disabled={info.status !== 'ok'} onClick={handleStart}>
        解析開始
      </button>
    </section>
  )
}
