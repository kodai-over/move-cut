// 画面遷移：動画選択 → 解析中 → 解析結果 の一本道
import { useEffect, useRef, useState } from 'react'
import type { Mode, MotionSample } from './analysis/types'
import { analyzeVideo } from './video/analyzeVideo'
import { UserFacingError } from './video/videoFile'
import { keepScreenAwake } from './ui/browser'
import { SelectScreen } from './ui/SelectScreen'
import { AnalyzingScreen } from './ui/AnalyzingScreen'
import { ResultScreen } from './ui/ResultScreen'

export interface SelectedVideo {
  file: File
  url: string
}

type State =
  | { screen: 'select'; error?: string }
  | { screen: 'analyzing'; progress: number }
  | { screen: 'result'; samples: MotionSample[]; duration: number }

function App() {
  const [state, setState] = useState<State>({ screen: 'select' })
  const [video, setVideo] = useState<SelectedVideo | null>(null)
  const [mode, setMode] = useState<Mode>('idea')
  const abortRef = useRef<AbortController | null>(null)

  // 選択中の動画の Object URL を差し替え時・終了時に解放する
  useEffect(() => {
    if (!video) return
    return () => URL.revokeObjectURL(video.url)
  }, [video])

  const selectFile = (file: File | null) => {
    setVideo(file ? { file, url: URL.createObjectURL(file) } : null)
    setState({ screen: 'select' })
  }

  const start = async () => {
    if (!video) return
    const controller = new AbortController()
    abortRef.current = controller
    setState({ screen: 'analyzing', progress: 0 })
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
          onBack={() => setState({ screen: 'select' })} />
      )}
    </main>
  )
}

export default App
