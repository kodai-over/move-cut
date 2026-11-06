// 動画選択画面：動画を1本選ぶと、読み込めしだい解析を始める
import { useEffect, useState } from 'react'
import type { SelectedVideo } from '../App'
import { createVideoElement, loadVideoInfo, supportWarnings, UserFacingError, type VideoInfo } from '../video/videoFile'

interface Props {
  video: SelectedVideo | null
  error?: string
  /** 選んだばかりの動画なら true（読み込めたら解析を始める。解析の失敗・中止で戻ってきたときは始めない） */
  autoStart: boolean
  onSelectFile: (file: File | null) => void
  onStart: () => void
  /** サポート範囲外の確認で「キャンセル」を選んだ */
  onDecline: () => void
}

type InfoState = { status: 'idle' } | { status: 'loading' } | { status: 'ok'; info: VideoInfo } | { status: 'error'; message: string }
type LoadResult = { url: string } & ({ status: 'ok'; info: VideoInfo } | { status: 'error'; message: string })

export function SelectScreen({ video, error, autoStart, onSelectFile, onStart, onDecline }: Props) {
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

  // 読み込めたら、サポート範囲外なら確かめてから解析を始める
  const ready = info.status === 'ok'
  useEffect(() => {
    if (!ready || !autoStart) return
    if (warnings.length > 0) {
      const ok = window.confirm(
        `${warnings.join('\n')}\n正式サポート外のため、解析が遅い・途中で止まる可能性があります。続けますか？`,
      )
      if (!ok) {
        onDecline()
        return
      }
    }
    onStart()
    // warnings は info から決まるので ready と同時に変わる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, autoStart])

  return (
    <section className="select">
      <h1 className="wordmark">MoveCut</h1>
      <label className="file-picker" title="動きのある区間を自動で切り出します">
        <input type="file" accept="video/*" onChange={(e) => {
            handleFile(e.target.files?.[0])
            // 同じ動画を選び直しても反応するように空にする
            e.target.value = ''
          }}
        />
        <span className="button primary">{info.status === 'loading' ? '読み込み中…' : '動画を選ぶ'}</span>
      </label>
      {info.status === 'error' && <p className="message error">{info.message}</p>}
      {fileError && <p className="message error">{fileError}</p>}
      {error && <p className="message error">{error}</p>}
    </section>
  )
}
