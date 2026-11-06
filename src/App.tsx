// 画面遷移：動画選択 → 解析中（1本目が終わるまで）→ 編集。
// 動画はまとめて選べ、1本目の解析が終わったら編集画面を開き、残りは裏で順に解析する
import { useEffect, useRef, useState } from 'react'
import { SEGMENT_DEFAULTS, type SegmentParams } from './config'
import { compareFileNames } from './timeline/sources'
import { analyzeVideo, type AnalysisResult } from './video/analyzeVideo'
import { UserFacingError } from './video/videoFile'
import { keepScreenAwake } from './ui/browser'
import { SelectScreen, type LoadedVideo } from './ui/SelectScreen'
import { AnalyzingScreen } from './ui/AnalyzingScreen'
import { EditScreen } from './ui/EditScreen'
import { UpdateBanner } from './ui/UpdateBanner'

export interface SelectedVideo {
  file: File
  url: string
}

/** 編集する動画（長さは解析前にメタデータから読む） */
export interface SourceVideo extends SelectedVideo {
  duration: number
}

/** 動画ごとの解析の状態 */
export type SourceAnalysis =
  | { status: 'pending' }
  | { status: 'done'; result: AnalysisResult }
  | { status: 'error'; message: string }

/** 裏で解析中の動画と進み具合 */
export interface AnalyzingProgress {
  index: number
  progress: number
}

type Screen = { screen: 'select'; error?: string } | { screen: 'analyzing' } | { screen: 'edit' }

function App() {
  const [state, setState] = useState<Screen>({ screen: 'select' })
  const [videos, setVideos] = useState<SelectedVideo[]>([])
  /** 選んだばかりの動画を、読み込めしだい解析する */
  const [autoStart, setAutoStart] = useState(false)
  const [sources, setSources] = useState<SourceVideo[]>([])
  const [analyses, setAnalyses] = useState<SourceAnalysis[]>([])
  const [analyzing, setAnalyzing] = useState<AnalyzingProgress | null>(null)
  // 区間のパラメータ。解析ごとに初期値に戻す
  const [params, setParams] = useState<SegmentParams>(SEGMENT_DEFAULTS.idea)
  const abortRef = useRef<AbortController | null>(null)

  // 選んだ動画の Object URL を差し替え時・終了時に解放する
  useEffect(() => {
    return () => videos.forEach((v) => URL.revokeObjectURL(v.url))
  }, [videos])

  // 画面を切り替えたら先頭から表示する（スクロール位置が前の画面のまま残らないように）
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [state.screen])

  const selectFiles = (files: File[]) => {
    abortRef.current?.abort()
    // 撮った順（ファイル名の連番）に並べる
    const sorted = [...files].sort((a, b) => compareFileNames(a.name, b.name))
    setVideos(sorted.map((file) => ({ file, url: URL.createObjectURL(file) })))
    setAutoStart(files.length > 0)
    setState({ screen: 'select' })
  }

  const start = async (loaded: LoadedVideo[]) => {
    setAutoStart(false)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const list: SourceVideo[] = loaded.map(({ video, info }) => ({ ...video, duration: info.duration }))
    setSources(list)
    setAnalyses(list.map(() => ({ status: 'pending' })))
    setState({ screen: 'analyzing' })
    setParams(SEGMENT_DEFAULTS.idea)
    const release = await keepScreenAwake()
    let firstError: string | null = null
    let anyDone = false
    try {
      for (let i = 0; i < list.length; i++) {
        if (controller.signal.aborted) return
        setAnalyzing({ index: i, progress: 0 })
        let next: SourceAnalysis
        try {
          const result = await analyzeVideo(list[i].url, {
            signal: controller.signal,
            onProgress: (progress) => setAnalyzing({ index: i, progress }),
          })
          next = { status: 'done', result }
          anyDone = true
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') return
          console.error(e)
          const message = e instanceof UserFacingError ? e.message : '解析中に予期しないエラーが起きました。'
          firstError ??= message
          next = { status: 'error', message }
        }
        if (controller.signal.aborted) return
        setAnalyses((prev) => prev.map((a, j) => (j === i ? next : a)))
        // 1本目の解析が終わったら（失敗した動画は飛ばして）編集画面を開く
        if (anyDone) setState((s) => (s.screen === 'analyzing' ? { screen: 'edit' } : s))
      }
      if (!anyDone) setState({ screen: 'select', error: firstError ?? '解析できませんでした。' })
    } finally {
      release()
      if (abortRef.current === controller) {
        abortRef.current = null
        setAnalyzing(null)
      }
    }
  }

  const cancel = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setAnalyzing(null)
    setState({ screen: 'select' })
  }

  return (
    <main className={`app ${state.screen}`}>
      {state.screen === 'select' && <UpdateBanner canUpdate />}
      {state.screen === 'select' && (
        <SelectScreen
          videos={videos}
          error={state.error}
          autoStart={autoStart}
          onSelectFiles={selectFiles}
          onStart={(loaded) => void start(loaded)}
          onDecline={() => setAutoStart(false)}
        />
      )}
      {state.screen === 'analyzing' && (
        <AnalyzingScreen
          progress={analyzing?.progress ?? 0}
          index={analyzing?.index ?? 0}
          total={sources.length}
          onCancel={cancel}
        />
      )}
      {state.screen === 'edit' && (
        <EditScreen
          sources={sources}
          analyses={analyses}
          analyzing={analyzing}
          params={params}
          onChangeParams={setParams}
          onBack={cancel}
        />
      )}
    </main>
  )
}

export default App
