// 動きスコア（左軸）と体幹角度（右軸）の折れ線グラフ。タップした時刻を onSeek で通知する
import { useEffect, useRef } from 'react'
import {
  Chart,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type Plugin,
} from 'chart.js'
import { CHART } from '../config'
import type { MotionSample } from '../analysis/types'

Chart.register(LineController, LineElement, PointElement, LinearScale, Tooltip, Legend)

interface Props {
  samples: MotionSample[]
  /** 再生位置（秒）。縦線で表示する */
  currentTime: number
  onSeek: (time: number) => void
}

/** 再生位置に縦線を引くプラグイン */
const cursorPlugin: Plugin<'line', { time: number }> = {
  id: 'cursor',
  afterDatasetsDraw(chart, _args, opts) {
    const x = chart.scales.x.getPixelForValue(opts.time)
    const { top, bottom, left, right } = chart.chartArea
    if (x < left || x > right) return
    const ctx = chart.ctx
    ctx.save()
    ctx.strokeStyle = '#ff5a36'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(x, top)
    ctx.lineTo(x, bottom)
    ctx.stroke()
    ctx.restore()
  },
}

export function MotionChart({ samples, currentTime, onSeek }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<Chart<'line', { x: number; y: number | null }[]> | null>(null)
  const onSeekRef = useRef(onSeek)
  useEffect(() => {
    onSeekRef.current = onSeek
  }, [onSeek])

  useEffect(() => {
    if (!canvasRef.current) return
    const duration = samples.length ? samples[samples.length - 1].time : 0
    const chart = new Chart(canvasRef.current, {
      type: 'line',
      data: {
        datasets: [
          {
            label: '動きスコア',
            data: samples.map((s) => ({ x: s.time, y: s.score })),
            borderColor: '#2f7cf6',
            borderWidth: 1.5,
            pointRadius: 0,
            yAxisID: 'y',
          },
          {
            label: '体幹角度',
            data: samples.map((s) => ({ x: s.time, y: s.trunkAngle })),
            borderColor: 'rgba(160, 160, 160, 0.6)',
            borderWidth: 1,
            pointRadius: 0,
            spanGaps: false,
            yAxisID: 'angle',
          },
        ],
      },
      options: {
        animation: false,
        maintainAspectRatio: false,
        parsing: false,
        normalized: true,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        scales: {
          x: { type: 'linear', min: 0, max: duration, title: { display: true, text: '秒' } },
          y: { type: 'linear', position: 'left', beginAtZero: true, title: { display: true, text: 'スコア' } },
          angle: {
            type: 'linear',
            position: 'right',
            min: 0,
            max: CHART.trunkAngleMaxDeg,
            grid: { drawOnChartArea: false },
            title: { display: true, text: '体幹角度（度）' },
          },
        },
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12 } },
          tooltip: {
            callbacks: {
              title: (items) => (items.length ? `${(items[0].parsed.x ?? 0).toFixed(1)}秒` : ''),
            },
          },
          // @ts-expect-error 独自プラグインのオプション
          cursor: { time: 0 },
        },
        onClick: (event, _elements, c) => {
          if (event.x == null) return
          const t = c.scales.x.getValueForPixel(event.x)
          if (t != null) onSeekRef.current(Math.max(0, Math.min(duration, t)))
        },
      },
      plugins: [cursorPlugin as Plugin<'line'>],
    })
    chartRef.current = chart
    return () => {
      chart.destroy()
      chartRef.current = null
    }
  }, [samples])

  // 再生位置の縦線だけを更新する
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    ;(chart.options.plugins as Record<string, unknown>).cursor = { time: currentTime }
    chart.update('none')
  }, [currentTime])

  return (
    <div className="chart">
      <canvas ref={canvasRef} aria-label="動きスコアのグラフ" role="img" />
    </div>
  )
}
