// 動画選択画面：動画をまとめて選ぶと、全部の長さを読み込めしだい解析を始める
import { useEffect, useState } from 'react'
import type { SelectedVideo } from '../App'
import { createVideoElement, loadVideoInfo, supportWarnings, UserFacingError, type VideoInfo } from '../video/videoFile'

export interface LoadedVideo {
  video: SelectedVideo
  info: VideoInfo
}

interface Props {
  videos: SelectedVideo[]
  error?: string
  /** 選んだばかりなら true（読み込めたら解析を始める。解析の失敗・中止で戻ってきたときは始めない） */
  autoStart: boolean
  onSelectFiles: (files: File[]) => void
  /** 読み込めた動画だけを渡す */
  onStart: (videos: LoadedVideo[]) => void
  /** サポート範囲外の確認で「キャンセル」を選んだ */
  onDecline: () => void
}

type LoadResult = { url: string } & ({ status: 'ok'; info: VideoInfo } | { status: 'error'; message: string })

/** 動画のメタデータ（長さ・解像度）を読む */
async function loadInfo(url: string): Promise<LoadResult> {
  const el = createVideoElement(url)
  try {
    return { url, status: 'ok', info: await loadVideoInfo(el) }
  } catch (e) {
    const message = e instanceof UserFacingError ? e.message : '動画を読み込めませんでした。'
    return { url, status: 'error', message }
  } finally {
    el.removeAttribute('src')
    el.load()
  }
}

export function SelectScreen({ videos, error, autoStart, onSelectFiles, onStart, onDecline }: Props) {
  const [loaded, setLoaded] = useState<{ videos: SelectedVideo[]; results: LoadResult[] } | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)

  // 選んだ動画のメタデータを順に読み、非対応形式やサポート範囲外を事前に知らせる
  useEffect(() => {
    if (videos.length === 0) return
    let cancelled = false
    void (async () => {
      const results: LoadResult[] = []
      for (const v of videos) {
        if (cancelled) return
        results.push(await loadInfo(v.url))
      }
      if (!cancelled) setLoaded({ videos, results })
    })()
    return () => {
      cancelled = true
    }
  }, [videos])

  const results = loaded?.videos === videos ? loaded.results : null
  const loading = videos.length > 0 && results === null

  const handleFiles = (list: FileList | null) => {
    // type が空の場合は判定できないので、読み込みを試して判断する
    const files = [...(list ?? [])].filter((f) => f.type === '' || f.type.startsWith('video/'))
    if (list && list.length > 0 && files.length === 0) {
      onSelectFiles([])
      setFileError('動画ファイルを選んでください。')
      return
    }
    setFileError(null)
    onSelectFiles(files)
  }

  // 読み込めたら、サポート範囲外なら確かめてから解析を始める（読み込めなかった動画は飛ばす）
  useEffect(() => {
    if (!results || !autoStart) return
    const ok: LoadedVideo[] = []
    results.forEach((r, i) => {
      if (r.status === 'ok') ok.push({ video: videos[i], info: r.info })
    })
    if (ok.length === 0) return
    const warnings = [...new Set(ok.flatMap((v) => supportWarnings(v.info)))]
    if (warnings.length > 0) {
      const confirmed = window.confirm(
        `${warnings.join('\n')}\n正式サポート外のため、解析が遅い・途中で止まる可能性があります。続けますか？`,
      )
      if (!confirmed) {
        onDecline()
        return
      }
    }
    onStart(ok)
    // videos は results と同時に決まる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, autoStart])

  const failed = results?.flatMap((r, i) => (r.status === 'error' ? [`${videos[i].file.name}：${r.message}`] : [])) ?? []

  return (
    <section className="select">
      <h1 className="wordmark">MoveCut</h1>
      <label className="file-picker" title="動きのある区間を自動で切り出します。まとめて選ぶと1本のタイムラインにつなげます">
        <input
          type="file"
          accept="video/*"
          multiple
          onChange={(e) => {
            handleFiles(e.target.files)
            // 同じ動画を選び直しても反応するように空にする
            e.target.value = ''
          }}
        />
        <span className="button primary">{loading ? '読み込み中…' : '動画を選ぶ'}</span>
      </label>
      {failed.map((m) => (
        <p key={m} className="message error">
          {m}
        </p>
      ))}
      {fileError && <p className="message error">{fileError}</p>}
      {error && <p className="message error">{error}</p>}
    </section>
  )
}
