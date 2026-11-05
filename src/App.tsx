// 画面遷移：動画選択 → 解析中 → 解析結果 → クリップ一覧 の一本道
import { useEffect, useRef, useState } from 'react'
import type { Mode, MotionSample } from './analysis/types'
import type { Interval } from './analysis/segment'
import { SEGMENT_DEFAULTS, type SegmentParams } from './config'
import { analyzeVideo } from './video/analyzeVideo'
import { UserFacingError } from './video/videoFile'
import { keepScreenAwake } from './ui/browser'
import { SelectScreen } from './ui/SelectScreen'
import { AnalyzingScreen } from './ui/AnalyzingScreen'
import { ResultScreen } from './ui/ResultScreen'
import { ClipListScreen } from './ui/ClipListScreen'
import { UpdateBanner } from './ui/UpdateBanner'

export interface SelectedVideo {
  file: File
  url: string
}

type State =
  | { screen: 'select'; error?: string }
  | { screen: 'analyzing'; progress: number }
  | { screen: 'result'; samples: MotionSample[]; duration: number }
  | { screen: 'clips'; samples: MotionSample[]; duration: number; clips: Interval[] }

function App() {
  const [state, setState] = useState<State>({ screen: 'select' })
  const [video, setVideo] = useState<SelectedVideo | null>(null)
  const [mode, setMode] = useState<Mode>('idea')
  // 区間のパラメータ。クリップ一覧から解析結果に戻ったときも調整を保つため、ここで持つ
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
    setState({ screen: 'select' })
  }

  const start = async () => {
    if (!video) return
    const controller = new AbortController()
    abortRef.current = controller
    setState({ screen: 'analyzing', progress: 0 })
    setParams(SEGMENT_DEFAULTS[mode])
    const release = await keepScreenAwake()
    try {
      const { samples, duration } = await analyzeVideo(video.url, {
        signal: controller.signal,
        onProgress: (progress) => setState({ screen: 'analyzing', progress }),
      })
      setState({ screen: 'result', samples, duration })
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
    <main className="app">
      <header className="app-header">
        <h1>MoveCut</h1>
      </header>
      <UpdateBanner canUpdate={state.screen === 'select'} />
      {state.screen === 'select' && (
        <SelectScreen
          video={video}
          mode={mode}
          error={state.error}
          onSelectFile={selectFile}
          onChangeMode={setMode}
          onStart={start}
        />
      )}
      {state.screen === 'analyzing' && (
        <AnalyzingScreen progress={state.progress} onCancel={() => abortRef.current?.abort()} />
      )}
      {state.screen === 'result' && video && (
        <ResultScreen
          video={video}
          mode={mode}
          samples={state.samples}
          duration={state.duration}
          params={params}
          onChangeParams={setParams}
          onShowClips={(clips) => setState({ screen: 'clips', samples: state.samples, duration: state.duration, clips })}
          onBack={() => setState({ screen: 'select' })}
        />
      )}
      {state.screen === 'clips' && video && (
        <ClipListScreen
          video={video}
          duration={state.duration}
          clips={state.clips}
          onBack={() => setState({ screen: 'result', samples: state.samples, duration: state.duration })}
        />
      )}
    </main>
  )
}

export default App
