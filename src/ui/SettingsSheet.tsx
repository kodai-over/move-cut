// 編集画面の設定（下から出るシート）：すべて残す／捨てる、AIの提案の作り直し、CSV、別の動画
import type { SegmentParams } from '../config'
import { Icon } from './icons'
import { ParamSliders } from './ParamSliders'

interface Props {
  params: SegmentParams
  onChangeParams: (params: SegmentParams) => void
  onResetParams: () => void
  onSetAll: (keep: boolean) => void
  onExportCsv: () => void
  onBack: () => void
  onClose: () => void
}

export function SettingsSheet({ params, onChangeParams, onResetParams, onSetAll, onExportCsv, onBack, onClose }: Props) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label="設定" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <div className="sheet-row">
            <button type="button" className="chip" onClick={() => onSetAll(true)}>
              すべて残す
            </button>
            <button type="button" className="chip" onClick={() => onSetAll(false)}>
              すべて捨てる
            </button>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="閉じる" title="閉じる">
            <Icon name="close" />
          </button>
        </div>
        <ParamSliders params={params} onChange={onChangeParams} onReset={onResetParams} />
        <div className="sheet-row">
          <button type="button" className="chip" onClick={onBack}>
            別の動画を選ぶ
          </button>
          <button type="button" className="chip quiet" onClick={onExportCsv} title="解析結果のCSV（デバッグ用）">
            CSV
          </button>
        </div>
      </div>
    </div>
  )
}
