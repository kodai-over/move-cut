// タイムライン：コマの帯・動きの波形・区間の帯を同じ時間軸で重ねる。
// 再生位置は中央に固定し、なぞってスクロールするとシーク、ピンチで拡大・縮小する。
// 区間の帯はタップで頭から再生、ダブルタップで残す／捨てる、選択中の帯は両端のつまみで伸縮する
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Interval } from '../analysis/segment'
import type { MotionSample } from '../analysis/types'
import { CHART, TIMELINE } from '../config'
import type { ClipEdge, EditClip } from '../timeline/clips'
import { clampZoom, fitZoom, timeToX, waveformColumns, xToTime } from '../timeline/scale'
import type { FilmstripFrame } from '../video/analyzeVideo'
import { formatDuration } from './labels'

interface Props {
  duration: number
  samples: MotionSample[]
  filmstrip: FilmstripFrame[]
  /** コマの縦横比（幅÷高さ） */
  frameAspect: number
  clips: EditClip[]
  freezes: Interval[]
  excluded: Interval[]
  startThreshold: number
  endThreshold: number
  /** キーフレームの時刻（読み取り中・失敗時は null） */
  keyframes: number[] | null
  currentTime: number
  selectedId: number | null
  /** 指でタイムラインに触れた（再生を止める） */
  onTouchStart: () => void
  /** なぞってスクロールした（その時刻へシークする） */
  onScrub: (time: number) => void
  /** 区間の帯をタップした（そのクリップを頭から再生する） */
  onTapClip: (id: number) => void
  /** 区間の帯をダブルタップした（残す／捨てるを切り替える） */
  onDoubleTapClip: (id: number) => void
  /** 帯のないところをタップした */
  onTapEmpty: () => void
  onTrimStart: (id: number, edge: ClipEdge) => void
  /** つまみをドラッグ中（time はつまみを動かした先の時刻） */
  onTrim: (time: number) => void
  onTrimEnd: () => void
}

const TRACK_TOP = TIMELINE.filmstripHeight + TIMELINE.waveformHeight
const CONTENT_HEIGHT = TRACK_TOP + TIMELINE.clipTrackHeight

export function Timeline(props: Props) {
  const { duration, clips, keyframes, currentTime, selectedId } = props
  const scrollRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [viewWidth, setViewWidth] = useState(0)
  /** スクロール量。スクロールのたびに再描画（React の更新）しないよう ref で持ち、波形だけを描き直す */
  const scrollLeftRef = useRef(0)
  const drawFrameRef = useRef(0)
  /** 拡大率（1秒あたりのpx）。null は全体表示 */
  const [zoom, setZoom] = useState<number | null>(null)

  const fit = fitZoom(viewWidth, duration)
  const pxPerSec = clampZoom(zoom ?? fit, fit, TIMELINE.maxPxPerSec)
  /** 先頭・末尾でも再生位置（中央）まで動かせるよう、左右に表示幅の半分の余白を付ける */
  const pad = viewWidth / 2
  const trackWidth = timeToX(duration, pxPerSec)

  // 表示領域の幅を測る（画面回転や幅の変化に追従）
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setViewWidth(el.clientWidth))
    observer.observe(el)
    setViewWidth(el.clientWidth)
    return () => observer.disconnect()
  }, [])

  // 再生位置が中央に来るようにスクロールする。指で触れている間（離した後の慣性スクロール中も）は動かさない。
  // プログラムで動かしたスクロールも scroll イベントを出すので、指（ホイール）で操作中かどうかで見分ける
  // （iOS は scrollLeft を設定した直後に読むと古い値を返すことがあり、値の比較では見分けられない）
  const interactingRef = useRef(false)
  const touchingRef = useRef(false)
  const scrollIdleRef = useRef(0)
  /** 操作が終わったら、その間に変わった再生位置へスクロールし直すために増やす */
  const [interactionEnded, setInteractionEnded] = useState(0)
  /** 指を離していれば、スクロールが止まってから操作を終わりにする */
  const endInteractionLater = () => {
    window.clearTimeout(scrollIdleRef.current)
    if (touchingRef.current) return
    scrollIdleRef.current = window.setTimeout(() => {
      interactingRef.current = false
      setInteractionEnded((n) => n + 1)
    }, TIMELINE.scrollIdleMs)
  }
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || viewWidth === 0 || interactingRef.current) return
    const x = timeToX(currentTime, pxPerSec)
    if (Math.abs(el.scrollLeft - x) < 0.5) return
    el.scrollLeft = x
    scrollLeftRef.current = x
  }, [currentTime, pxPerSec, viewWidth, interactionEnded])

  // ピンチで拡大・縮小する（中央の再生位置を基準にする）
  const zoomLimitsRef = useRef({ pxPerSec, fit })
  useEffect(() => {
    zoomLimitsRef.current = { pxPerSec, fit }
  }, [pxPerSec, fit])
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const pinch: { current: { dist: number; zoom: number } | null } = { current: null }
    const distance = (e: TouchEvent) =>
      Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return
      e.preventDefault()
      // ピンチ中は中央の再生位置を基準にするので、自動スクロールを止めない
      interactingRef.current = false
      touchingRef.current = false
      pinch.current = { dist: Math.max(1, distance(e)), zoom: zoomLimitsRef.current.pxPerSec }
    }
    const onMove = (e: TouchEvent) => {
      const start = pinch.current
      if (!start || e.touches.length !== 2) return
      e.preventDefault()
      const { fit: min } = zoomLimitsRef.current
      const next = clampZoom((start.zoom * distance(e)) / start.dist, min, TIMELINE.maxPxPerSec)
      setZoom(next <= min + 1e-6 ? null : next)
    }
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch.current = null
    }
    el.addEventListener('touchstart', onStart, { passive: false })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [])

  // 波形は見えている範囲だけを、表示幅のキャンバスに描く（長い動画でもキャンバスが大きくなりすぎないように）
  const sampleTimes = useMemo(() => props.samples.map((s) => s.time), [props.samples])
  const scores = useMemo(() => props.samples.map((s) => s.score), [props.samples])
  const maxScore = useMemo(
    () => Math.max(props.startThreshold * CHART.scoreAxisHeadroom, 1e-6, ...scores),
    [scores, props.startThreshold],
  )

  const draw = useCallback(() => {
    // キャンバスの左端の位置（時刻0からのpx）。先頭付近では負になる
    const origin = scrollLeftRef.current - pad
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
        const x0 = timeToX(it.start, pxPerSec) - origin
        const x1 = timeToX(it.end, pxPerSec) - origin
        if (x1 < 0 || x0 > viewWidth) continue
        ctx.fillRect(x0, 0, Math.max(1, x1 - x0), h)
      }
    }
    band(props.excluded, CHART.excludedColor)
    band(props.freezes, CHART.freezeColor)

    const y = (v: number) => h - 2 - (v / maxScore) * (h - 4)
    const left = Math.max(0, -origin)
    const right = Math.min(viewWidth, timeToX(duration, pxPerSec) - origin)

    ctx.strokeStyle = CHART.thresholdColor
    ctx.lineWidth = 1
    for (const [value, dash] of [
      [props.startThreshold, []],
      [props.endThreshold, [...CHART.endThresholdDash]],
    ] as const) {
      ctx.setLineDash(dash)
      ctx.beginPath()
      ctx.moveTo(left, y(value))
      ctx.lineTo(right, y(value))
      ctx.stroke()
    }
    ctx.setLineDash([])

    // 時刻0より左（先頭の余白）は描かない
    const cols = waveformColumns(sampleTimes, scores, pxPerSec, Math.max(0, origin), viewWidth - left)
    ctx.strokeStyle = CHART.scoreColor
    ctx.lineWidth = 1.5
    ctx.beginPath()
    let drawing = false
    cols.forEach((v, x) => {
      if (v === null) return
      if (drawing) ctx.lineTo(x + left, y(v))
      else ctx.moveTo(x + left, y(v))
      drawing = true
    })
    ctx.stroke()
  }, [viewWidth, pad, pxPerSec, duration, sampleTimes, scores, maxScore, props.excluded, props.freezes, props.startThreshold, props.endThreshold])

  // 次の描画フレームで1回だけ描き直す
  const requestDraw = useCallback(() => {
    cancelAnimationFrame(drawFrameRef.current)
    drawFrameRef.current = requestAnimationFrame(draw)
  }, [draw])

  useEffect(() => {
    requestDraw()
    return () => cancelAnimationFrame(drawFrameRef.current)
  }, [requestDraw])

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    scrollLeftRef.current = el.scrollLeft
    requestDraw()
    if (!interactingRef.current) return
    endInteractionLater()
    props.onScrub(xToTime(el.scrollLeft, pxPerSec, duration))
  }
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return
    interactingRef.current = true
    touchingRef.current = true
    window.clearTimeout(scrollIdleRef.current)
    props.onTouchStart()
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length > 0) return
    touchingRef.current = false
    endInteractionLater()
  }
  const onWheel = () => {
    interactingRef.current = true
    endInteractionLater()
  }
  useEffect(() => () => window.clearTimeout(scrollIdleRef.current), [])

  // 1回目のタップで頭から再生し、続けて同じ帯をタップしたらダブルタップとして残す／捨てるを切り替える。
  // （ダブルタップを待ってから再生すると反応が遅れるので、1回目はすぐ再生する）
  const lastTapRef = useRef<{ id: number; at: number } | null>(null)
  const clipClick = (id: number) => (e: React.MouseEvent) => {
    e.stopPropagation()
    const now = e.timeStamp
    const last = lastTapRef.current
    if (last && last.id === id && now - last.at <= TIMELINE.doubleTapMs) {
      lastTapRef.current = null
      props.onDoubleTapClip(id)
      return
    }
    lastTapRef.current = { id, at: now }
    props.onTapClip(id)
  }

  // つまみのドラッグ。動かした量を時刻に直して渡す（吸着・合体は呼び出し側で計算する）
  const dragRef = useRef<{ pointerId: number; startX: number; startTime: number } | null>(null)
  const handleDown = (c: EditClip, edge: ClipEdge) => (e: React.PointerEvent) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startTime: edge === 'start' ? c.start : c.end }
    props.onTrimStart(c.id, edge)
  }
  const handleMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    props.onTrim(drag.startTime + (e.clientX - drag.startX) / pxPerSec)
  }
  const handleUp = (e: React.PointerEvent) => {
    if (dragRef.current?.pointerId !== e.pointerId) return
    dragRef.current = null
    props.onTrimEnd()
  }

  const showKeyframes = keyframes !== null && pxPerSec >= TIMELINE.keyframeTickMinPxPerSec

  return (
    <div
      className="timeline"
      title="水色はフリーズ、薄い灰色は動きとして数えなかった時間。黄色の実線が開始閾値、破線が終了閾値。ピンチで拡大・縮小"
    >
      <div
        ref={scrollRef}
        className="timeline-scroll"
        onScroll={onScroll}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onWheel={onWheel}
        onClick={props.onTapEmpty}
      >
        <div className="timeline-content" style={{ width: trackWidth + viewWidth, height: CONTENT_HEIGHT }}>
          <Filmstrip
            filmstrip={props.filmstrip}
            frameAspect={props.frameAspect}
            pxPerSec={pxPerSec}
            left={pad}
            width={trackWidth}
          />
          <canvas
            ref={canvasRef}
            className="waveform"
            // 横スクロールしても表示領域の左端に留まる（position: sticky）。見えている範囲だけを描く
            style={{ top: TIMELINE.filmstripHeight, width: viewWidth, height: TIMELINE.waveformHeight }}
          />
          <div
            className="clip-track"
            style={{ top: TRACK_TOP, left: pad, width: trackWidth, height: TIMELINE.clipTrackHeight }}
          >
            {showKeyframes &&
              keyframes.map((k) => <span key={k} className="keyframe-tick" style={{ left: timeToX(k, pxPerSec) }} />)}
            {clips.map((c, i) => {
              const left = timeToX(c.start, pxPerSec)
              const width = Math.max(2, timeToX(c.end - c.start, pxPerSec))
              const selected = c.id === selectedId
              return (
                <div
                  key={c.id}
                  className={`clip-band${c.keep ? ' keep' : ''}${selected ? ' selected' : ''}`}
                  style={{ left, width }}
                >
                  <button
                    type="button"
                    className="clip-body"
                    onClick={clipClick(c.id)}
                    title="タップで再生、ダブルタップで残す／捨てる"
                    aria-label={`クリップ${i + 1}（${formatDuration(c.start)}〜${formatDuration(c.end)}・${c.keep ? '残す' : '捨てる'}）`}
                  >
                    {width > 40 && formatDuration(c.end - c.start)}
                  </button>
                  {selected &&
                    (['start', 'end'] as const).map((edge) => (
                      <span
                        key={edge}
                        className={`clip-handle ${edge}`}
                        onPointerDown={handleDown(c, edge)}
                        onPointerMove={handleMove}
                        onPointerUp={handleUp}
                        onPointerCancel={handleUp}
                        onClick={(e) => e.stopPropagation()}
                        title={edge === 'start' ? 'ドラッグで開始位置を変える（キーフレームに吸着）' : 'ドラッグで終わり位置を変える'}
                      />
                    ))}
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <div className="playhead" style={{ height: CONTENT_HEIGHT }} />
    </div>
  )
}

interface FilmstripProps {
  filmstrip: FilmstripFrame[]
  frameAspect: number
  pxPerSec: number
  left: number
  width: number
}

/** コマの帯。再生中は親が毎フレーム更新されるので、拡大率などが変わったときだけ作り直す */
const Filmstrip = memo(function Filmstrip({ filmstrip, frameAspect, pxPerSec, left, width }: FilmstripProps) {
  // 縮小していてコマが細くなりすぎるときは、間引いて1枚を本来の幅で並べる
  const slotWidth = TIMELINE.filmstripIntervalSec * pxPerSec
  const thumbWidth = frameAspect * TIMELINE.filmstripHeight
  const frameStep = Math.max(1, Math.ceil(thumbWidth / slotWidth))
  return (
    <div className="filmstrip" style={{ left, width, height: TIMELINE.filmstripHeight }}>
      {filmstrip
        .filter((_, i) => i % frameStep === 0)
        .map((f, i) => {
          // 最初のコマは先頭（時刻0）から敷き詰める
          const left = i === 0 ? 0 : timeToX(f.time, pxPerSec)
          const right = timeToX(f.time, pxPerSec) + slotWidth * frameStep
          return (
            <img
              key={f.time}
              src={f.url}
              alt=""
              draggable={false}
              style={{ left, width: right - left + 0.5, height: TIMELINE.filmstripHeight }}
            />
          )
        })}
    </div>
  )
})
