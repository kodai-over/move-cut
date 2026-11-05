// 動画選択画面：動画を1本選んで解析を始める
import { useEffect, useState } from 'react'
import type { SelectedVideo } from '../App'
import { formatDuration } from './labels'
import { createVideoElement, loadVideoInfo, supportWarnings, UserFacingError, type VideoInfo } from '../video/videoFile'

interface Props {
  video: SelectedVideo | null
  error?: string
  onSelectFile: (file: File | null) => void
  onStart: () => void
}

type InfoState = { status: 'idle' } | { status: 'loading' } | { status: 'ok'; info: VideoInfo } | { status: 'error'; message: string }
type LoadResult = { url: string } & ({ status: 'ok'; info: VideoInfo } | { status: 'error'; message: string })

export function SelectScreen({ video, error, onSelectFile, onStart }: Props) {
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

      {error && <p className="message error">{error}</p>}

      <button className="button primary" disabled={info.status !== 'ok'} onClick={handleStart}>
        解析開始
      </button>
    </section>
  )
}
