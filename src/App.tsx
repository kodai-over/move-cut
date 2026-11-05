// 画面遷移：動画選択 → 解析中 → 編集 の一本道
import { useEffect, useRef, useState } from 'react'
import { SEGMENT_DEFAULTS, type SegmentParams } from './config'
import { analyzeVideo, type AnalysisResult } from './video/analyzeVideo'
import { UserFacingError } from './video/videoFile'
import { keepScreenAwake } from './ui/browser'
import { SelectScreen } from './ui/SelectScreen'
import { AnalyzingScreen } from './ui/AnalyzingScreen'
import { EditScreen } from './ui/EditScreen'
import { UpdateBanner } from './ui/UpdateBanner'

export interface SelectedVideo {
  file: File
  url: string
}

type State =
  | { screen: 'select'; error?: string }
  | { screen: 'analyzing'; progress: number }
  | ({ screen: 'edit' } & AnalysisResult)

function App() {
  const [state, setState] = useState<State>({ screen: 'select' })
  const [video, setVideo] = useState<SelectedVideo | null>(null)
  /** 選んだばかりの動画を、読み込めしだい解析する */
  const [autoStart, setAutoStart] = useState(false)
  // 区間のパラメータ。解析ごとに初期値に戻す
  const [params, setParams] = useState<SegmentParams>(SEGMENT_DEFAULTS.idea)
  const abortRef = useRef<AbortController | null>(null)

  // 選択中の動画の Object URL を差し替え時・終了時に解放する
  useEffect(() => {
    if (!video) return
    return () => URL.revokeObjectURL(video.url)
  }, [video])

  // 画面を切り替えたら先頭から表示する（スクロール位置が前の画面のまま残らないように）
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [state.screen])

  const selectFile = (file: File | null) => {
    setVideo(file ? { file, url: URL.createObjectURL(file) } : null)
    setAutoStart(file !== null)
    setState({ screen: 'select' })
  }

  const start = async () => {
    if (!video) return
    setAutoStart(false)
    const controller = new AbortController()
    abortRef.current = controller
    setState({ screen: 'analyzing', progress: 0 })
    setParams(SEGMENT_DEFAULTS.idea)
    const release = await keepScreenAwake()
    try {
      const result = await analyzeVideo(video.url, {
        signal: controller.signal,
        onProgress: (progress) => setState({ screen: 'analyzing', progress }),
      })
      setState({ screen: 'edit', ...result })
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setState({ screen: 'select' })
      } else {
        console.error(e)
        const message = e instanceof UserFacingError ? e.message : '解析中に予期しないエラーが起きました。'
        setState({ screen: 'select', error: message })
      }
    } finally {
      release()
      abortRef.current = null
    }
  }

  return (
    <main className={`app ${state.screen}`}>
      {state.screen === 'select' && <UpdateBanner canUpdate />}
      {state.screen === 'select' && (
        <SelectScreen
          video={video}
          error={state.error}
          autoStart={autoStart}
          onSelectFile={selectFile}
          onStart={start}
          onDecline={() => setAutoStart(false)}
        />
      )}
      {state.screen === 'analyzing' && (
        <AnalyzingScreen progress={state.progress} onCancel={() => abortRef.current?.abort()} />
      )}
      {state.screen === 'edit' && video && (
        <EditScreen
          video={video}
          samples={state.samples}
          duration={state.duration}
          filmstrip={state.filmstrip}
          frameAspect={state.frameAspect}
          params={params}
          onChangeParams={setParams}
          onBack={() => setState({ screen: 'select' })}
        />
      )}
    </main>
  )
}

export default App
