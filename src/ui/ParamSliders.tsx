// 区間切り出しのパラメータを変えるスライダー。変更は即座に区間の再計算に反映される
import { SLIDER, type SegmentParams } from '../config'

interface Props {
  params: SegmentParams
  onChange: (params: SegmentParams) => void
  onReset: () => void
}

interface SliderProps {
  label: string
  hint: string
  value: number
  range: { min: number; max: number; step: number }
  format: (v: number) => string
  onChange: (v: number) => void
}

function Slider({ label, hint, value, range, format, onChange }: SliderProps) {
  return (
    <label className="slider" title={hint}>
      <span className="slider-head">
        <span>{label}</span>
        <output>{format(value)}</output>
      </span>
      <input
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
    </label>
  )
}

const score = (v: number) => v.toFixed(3)
const sec = (v: number) => `${v.toFixed(1)}秒`

export function ParamSliders({ params, onChange, onReset }: Props) {
  const set = (patch: Partial<SegmentParams>) => onChange({ ...params, ...patch })
  return (
    <div className="sliders">
      <Slider
        label="開始閾値"
        hint="動きのスコアがこれを超えたら動き始めとみなす"
        value={params.startThreshold}
        range={SLIDER.threshold}
        format={score}
        // 終了閾値は開始閾値を超えないようにする
        onChange={(v) => set({ startThreshold: v, endThreshold: Math.min(params.endThreshold, v) })}
      />
      <Slider
        label="終了閾値"
        hint="動きのスコアがこれを下回る状態が区切り静止秒数続いたら止まったとみなす"
        value={params.endThreshold}
        range={SLIDER.threshold}
        format={score}
        onChange={(v) => set({ endThreshold: Math.min(v, params.startThreshold) })}
      />
      <Slider
        label="区切り静止"
        hint="この秒数止まっていたら、そこでクリップを区切る"
        value={params.stillSec}
        range={SLIDER.stillSec}
        format={sec}
        onChange={(v) => set({ stillSec: v })}
      />
      <Slider
        label="前の余白"
        hint="クリップの前に付ける時間"
        value={params.marginBeforeSec}
        range={SLIDER.marginSec}
        format={sec}
        onChange={(v) => set({ marginBeforeSec: v })}
      />
      <Slider
        label="後の余白"
        hint="クリップの後に付ける時間"
        value={params.marginAfterSec}
        range={SLIDER.marginSec}
        format={sec}
        onChange={(v) => set({ marginAfterSec: v })}
      />
      <button type="button" className="chip quiet" onClick={onReset}>
        初期値に戻す
      </button>
    </div>
  )
}
