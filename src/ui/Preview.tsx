// プレビュー動画。シークバーは出さず（タイムラインで操作する）、タップで再生／停止、長押しの間だけ2倍速で再生する
import { useRef, useState, type ReactNode, type RefObject } from 'react'
import { PREVIEW } from '../config'
import { formatDuration } from './labels'

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>
  src: string
  currentTime: number
  duration: number
  playing: boolean
  onTogglePlay: () => void
  onPlayingChange: (playing: boolean) => void
  /** 動画を読み込めた（書き出し画面から戻ったときなどに、再生位置を戻すのに使う） */
  onLoaded: () => void
  /** 動画の上に重ねる操作（戻る・設定・書き出しなど） */
  children?: ReactNode
}

export function Preview({ videoRef, src, currentTime, duration, playing, onTogglePlay, onPlayingChange, onLoaded, children }: Props) {
  const [fast, setFast] = useState(false)
  const pressRef = useRef<{ timer: number; long: boolean; wasPlaying: boolean; wasMuted: boolean } | null>(null)
  const video = () => videoRef.current

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const press = { timer: 0, long: false, wasPlaying: playing, wasMuted: videoRef.current?.muted ?? false }
    press.timer = window.setTimeout(() => {
      const el = video()
      if (!el) return
      press.long = true
      el.playbackRate = PREVIEW.fastRate
      // タイマーの中の play() は操作によるものとみなされず断られることがあるので、そのときは無音で再生する
      void el.play().catch(() => {
        el.muted = true
        return el.play().catch(() => {})
      })
      setFast(true)
    }, PREVIEW.longPressMs)
    pressRef.current = press
  }

  const endPress = (cancelled: boolean) => {
    const press = pressRef.current
    pressRef.current = null
    if (!press) return
    window.clearTimeout(press.timer)
    if (press.long) {
      const el = video()
      if (el) {
        el.playbackRate = 1
        el.muted = press.wasMuted
        // 止まっていたときに長押ししたなら、離したら止める（再生中なら等速で再生を続ける）
        if (!press.wasPlaying) el.pause()
      }
      setFast(false)
    } else if (!cancelled) {
      onTogglePlay()
    }
  }

  return (
    <div className="preview">
      <div
        className="preview-surface"
        onPointerDown={onPointerDown}
        onPointerUp={() => endPress(false)}
        onPointerCancel={() => endPress(true)}
        onPointerLeave={() => endPress(true)}
        onContextMenu={(e) => e.preventDefault()}
        title="タップで再生／停止、長押しで2倍速"
      >
        <video
          ref={videoRef}
          src={src}
          playsInline
          preload="auto"
          onPlay={() => onPlayingChange(true)}
          onPause={() => onPlayingChange(false)}
          onLoadedMetadata={onLoaded}
        />
        {!playing && !fast && (
          <svg className="preview-play" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 5.5v13l11-6.5z" />
          </svg>
        )}
        {fast && <span className="preview-fast">{PREVIEW.fastRate}×</span>}
      </div>
      <span className="preview-time">
        {formatDuration(currentTime)}
        <span> / {formatDuration(duration)}</span>
      </span>
      {children}
    </div>
  )
}
