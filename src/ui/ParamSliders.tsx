// 区間切り出しのパラメータを変えるスライダー。変更は即座に区間の再計算に反映される
import { SLIDER, type SegmentParams } from '../config'

interface Props {
  params: SegmentParams
  /** 通し練習モードでは区切り静止秒数を使わない（最初〜最後を1区間にするため）ので表示しない */
  showStillSec: boolean
  onChange: (params: SegmentParams) => void
  onReset: () => void
}

interface SliderProps {
  label: string
  value: number
  range: { min: number; max: number; step: number }
  format: (v: number) => string
  onChange: (v: number) => void
}

function Slider({ label, value, range, format, onChange }: SliderProps) {
  return (
    <label className="slider">
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

export function ParamSliders({ params, showStillSec, onChange, onReset }: Props) {
  const set = (patch: Partial<SegmentParams>) => onChange({ ...params, ...patch })
  return (
    <fieldset className="sliders">
      <legend>切り出しの調整</legend>
      <Slider
        label="開始閾値（これを超えたら動き）"
        value={params.startThreshold}
        range={SLIDER.threshold}
        format={score}
        // 終了閾値は開始閾値を超えないようにする
        onChange={(v) => set({ startThreshold: v, endThreshold: Math.min(params.endThreshold, v) })}
      />
      <Slider
        label="終了閾値（これを下回ったら静止）"
        value={params.endThreshold}
        range={SLIDER.threshold}
        format={score}
        onChange={(v) => set({ endThreshold: Math.min(v, params.startThreshold) })}
      />
      {showStillSec && (
        <Slider
          label="区切り静止秒数"
          value={params.stillSec}
          range={SLIDER.stillSec}
          format={sec}
          onChange={(v) => set({ stillSec: v })}
        />
      )}
      <Slider
        label="前の余白"
        value={params.marginBeforeSec}
        range={SLIDER.marginSec}
        format={sec}
        onChange={(v) => set({ marginBeforeSec: v })}
      />
      <Slider
        label="後の余白"
        value={params.marginAfterSec}
        range={SLIDER.marginSec}
        format={sec}
        onChange={(v) => set({ marginAfterSec: v })}
      />
      <button type="button" className="button ghost" onClick={onReset}>
        初期値に戻す
      </button>
    </fieldset>
  )
}
