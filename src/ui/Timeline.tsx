// タイムライン：コマの帯・動きの波形・区間の帯を同じ時間軸で重ねる。横スクロールと拡大・縮小、タップでシーク
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Interval } from '../analysis/segment'
import type { MotionSample } from '../analysis/types'
import { CHART, TIMELINE } from '../config'
import { clampZoom, fitZoom, scrollForAnchor, timeToX, waveformColumns, xToTime } from '../timeline/scale'
import type { FilmstripFrame } from '../video/analyzeVideo'
import { formatDuration } from './labels'

export interface TimelineClip extends Interval {
  keep: boolean
}

interface Props {
  duration: number
  samples: MotionSample[]
  filmstrip: FilmstripFrame[]
  /** コマの縦横比（幅÷高さ） */
  frameAspect: number
  clips: TimelineClip[]
  freezes: Interval[]
  excluded: Interval[]
  startThreshold: number
  endThreshold: number
  /** キーフレームの時刻（読み取り中・失敗時は null） */
  keyframes: number[] | null
  currentTime: number
  selected: number | null
  onSeek: (time: number) => void
  onSelectClip: (index: number, time: number) => void
}

export function Timeline(props: Props) {
  const { duration, filmstrip, clips, keyframes, currentTime, selected, onSeek, onSelectClip } = props
  const scrollRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [viewWidth, setViewWidth] = useState(0)
  const [scrollLeft, setScrollLeft] = useState(0)
  /** 拡大率（1秒あたりのpx）。null は全体表示 */
  const [zoom, setZoom] = useState<number | null>(null)
  /** 拡大・縮小の直後に合わせるスクロール量 */
  const pendingScrollRef = useRef<number | null>(null)

  const fit = fitZoom(viewWidth, duration)
  const pxPerSec = clampZoom(zoom ?? fit, fit, TIMELINE.maxPxPerSec)
  const contentWidth = Math.max(viewWidth, timeToX(duration, pxPerSec))

  // 表示領域の幅を測る（画面回転や幅の変化に追従）
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setViewWidth(el.clientWidth))
    observer.observe(el)
    setViewWidth(el.clientWidth)
    return () => observer.disconnect()
  }, [])

  // 拡大・縮小した後、基準の時刻が同じ位置に見えるようスクロールを合わせる
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || pendingScrollRef.current === null) return
    el.scrollLeft = pendingScrollRef.current
    pendingScrollRef.current = null
    setScrollLeft(el.scrollLeft)
  }, [pxPerSec])

  // 再生位置が見えなくなったら、再生位置が左から1/3の位置に来るようスクロールする
  useEffect(() => {
    const el = scrollRef.current
    if (!el || viewWidth === 0) return
    const x = timeToX(currentTime, pxPerSec)
    if (x < el.scrollLeft || x > el.scrollLeft + viewWidth - 8) {
      el.scrollLeft = Math.max(0, x - viewWidth / 3)
    }
  }, [currentTime, pxPerSec, viewWidth])

  const changeZoom = (next: number | null) => {
    const el = scrollRef.current
    const target = clampZoom(next ?? fit, fit, TIMELINE.maxPxPerSec)
    if (el) {
      // 再生位置が見えていればそこを、見えていなければ表示の中央を基準にする
      const playX = timeToX(currentTime, pxPerSec) - el.scrollLeft
      const anchorX = playX >= 0 && playX <= viewWidth ? playX : viewWidth / 2
      const anchorTime = xToTime(el.scrollLeft + anchorX, pxPerSec, duration)
      pendingScrollRef.current = scrollForAnchor(anchorTime, anchorX, target)
    }
    setZoom(next === null ? null : target)
  }

  // 波形は見えている範囲だけを、表示幅のキャンバスに描く（長い動画でもキャンバスが大きくなりすぎないように）
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || viewWidth === 0) return
    const dpr = window.devicePixelRatio || 1
    const h = TIMELINE.waveformHeight
    canvas.width = Math.round(viewWidth * dpr)
    canvas.height = Math.round(h * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, viewWidth, h)

    const band = (list: Interval[], color: string) => {
      ctx.fillStyle = color
      for (const it of list) {
        const x0 = timeToX(it.start, pxPerSec) - scrollLeft
        const x1 = timeToX(it.end, pxPerSec) - scrollLeft
        if (x1 < 0 || x0 > viewWidth) continue
        ctx.fillRect(x0, 0, Math.max(1, x1 - x0), h)
      }
    }
    band(props.excluded, CHART.excludedColor)
    band(props.freezes, CHART.freezeColor)

    const scores = props.samples.map((s) => s.score)
    const maxScore = Math.max(props.startThreshold * CHART.scoreAxisHeadroom, ...scores, 1e-6)
    const y = (v: number) => h - 2 - (v / maxScore) * (h - 4)

    ctx.strokeStyle = CHART.thresholdColor
    ctx.lineWidth = 1
    for (const [value, dash] of [
      [props.startThreshold, []],
      [props.endThreshold, [...CHART.endThresholdDash]],
    ] as const) {
      ctx.setLineDash(dash)
      ctx.beginPath()
      ctx.moveTo(0, y(value))
      ctx.lineTo(viewWidth, y(value))
      ctx.stroke()
    }
    ctx.setLineDash([])

    const cols = waveformColumns(
      props.samples.map((s) => s.time),
      scores,
      pxPerSec,
      scrollLeft,
      viewWidth,
    )
    ctx.strokeStyle = CHART.scoreColor
    ctx.lineWidth = 1.5
    ctx.beginPath()
    let drawing = false
    cols.forEach((v, x) => {
      if (v === null) return
      if (drawing) ctx.lineTo(x, y(v))
      else ctx.moveTo(x, y(v))
      drawing = true
    })
    ctx.stroke()
  }, [viewWidth, pxPerSec, scrollLeft, props.samples, props.excluded, props.freezes, props.startThreshold, props.endThreshold])

  useEffect(() => {
    const raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [draw])

  // タップでシーク（スクロールの指の動きでは click が発生しないので、なぞってスクロールしてもシークしない）
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = scrollRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    onSeek(xToTime(e.clientX - rect.left + el.scrollLeft, pxPerSec, duration))
  }

  const clipClick = (i: number) => (e: React.MouseEvent) => {
    e.stopPropagation()
    const el = scrollRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    onSelectClip(i, xToTime(e.clientX - rect.left + el.scrollLeft, pxPerSec, duration))
  }

  // 縮小していてコマが細くなりすぎるときは、間引いて1枚を本来の幅で並べる
  const slotWidth = TIMELINE.filmstripIntervalSec * pxPerSec
  const thumbWidth = props.frameAspect * TIMELINE.filmstripHeight
  const frameStep = Math.max(1, Math.ceil(thumbWidth / slotWidth))
  const showKeyframes = keyframes !== null && pxPerSec >= TIMELINE.keyframeTickMinPxPerSec
  const trackTop = TIMELINE.filmstripHeight + TIMELINE.waveformHeight

  return (
    <div className="timeline">
      <div className="timeline-toolbar">
        <span className="timeline-time">
          {formatDuration(currentTime)} / {formatDuration(duration)}
        </span>
        <div className="timeline-zoom">
          <button type="button" onClick={() => changeZoom(pxPerSec / TIMELINE.zoomStep)} disabled={pxPerSec <= fit + 1e-6} aria-label="縮小">
            －
          </button>
          <button type="button" onClick={() => changeZoom(null)} disabled={zoom === null}>
            全体
          </button>
          <button
            type="button"
            onClick={() => changeZoom(pxPerSec * TIMELINE.zoomStep)}
            disabled={pxPerSec >= TIMELINE.maxPxPerSec - 1e-6}
            aria-label="拡大"
          >
            ＋
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="timeline-scroll"
        onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
        onClick={onClick}
      >
        <div
          className="timeline-content"
          // 波形のキャンバスはコマの帯の下に置く（padding で下げる。margin だと親と相殺されてずれる）
          style={{
            width: contentWidth,
            height: trackTop + TIMELINE.clipTrackHeight,
            paddingTop: TIMELINE.filmstripHeight,
          }}
        >
          <div className="filmstrip" style={{ height: TIMELINE.filmstripHeight }}>
            {filmstrip
              .filter((_, i) => i % frameStep === 0)
              .map((f) => (
                <img
                  key={f.time}
                  src={f.url}
                  alt=""
                  draggable={false}
                  style={{
                    left: timeToX(f.time, pxPerSec),
                    width: slotWidth * frameStep + 0.5,
                    height: TIMELINE.filmstripHeight,
                  }}
                />
              ))}
          </div>
          <canvas
            ref={canvasRef}
            className="waveform"
            // 横スクロールしても表示領域の左端に留まる（position: sticky）。見えている範囲だけを描く
            style={{ width: viewWidth, height: TIMELINE.waveformHeight }}
          />
          <div className="clip-track" style={{ top: trackTop, height: TIMELINE.clipTrackHeight }}>
            {clips.map((c, i) => {
              const left = timeToX(c.start, pxPerSec)
              const width = Math.max(2, timeToX(c.end - c.start, pxPerSec))
              return (
                <button
                  type="button"
                  key={`${c.start}-${c.end}`}
                  className={`clip-band${c.keep ? ' keep' : ''}${selected === i ? ' selected' : ''}`}
                  style={{ left, width }}
                  onClick={clipClick(i)}
                  aria-label={`クリップ${i + 1}（${formatDuration(c.start)}〜${formatDuration(c.end)}）`}
                >
                  {width > 20 ? i + 1 : ''}
                </button>
              )
            })}
            {showKeyframes &&
              keyframes.map((k) => <span key={k} className="keyframe-tick" style={{ left: timeToX(k, pxPerSec) }} />)}
          </div>
          <div
            className="playhead"
            style={{ left: timeToX(currentTime, pxPerSec), height: trackTop + TIMELINE.clipTrackHeight }}
          />
        </div>
      </div>
    </div>
  )
}
