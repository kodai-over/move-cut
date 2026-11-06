// 書き出し画面：残すクリップを並べて見せ、写真アプリに保存する（まとめて選んだ動画のクリップもまとめて保存する）
import type { RefObject } from 'react'
import { estimateClipBytes, type NumberedClip } from '../export/batch'
import { splitFileName } from '../export/naming'
import type { AnalysisResult, FilmstripFrame } from '../video/analyzeVideo'
import type { SourceVideo } from '../App'
import { ClipSaver } from './ClipSaver'
import { Icon } from './icons'
import { formatDuration } from './labels'
import type { ExporterQueue } from './useClipExporter'

interface Props {
  sources: SourceVideo[]
  /** 動画ごとの解析結果（解析中・失敗は null） */
  results: (AnalysisResult | null)[]
  chosen: NumberedClip[]
  /** まだ解析が終わっていない動画の本数（その動画のクリップは含まれない） */
  pendingCount: number
  exporter: ExporterQueue
  /** 書き出し済みのファイル（画面を離れても持っておく） */
  cacheRef: RefObject<ReadonlyMap<string, File>>
  busy: boolean
  onBusyChange: (busy: boolean) => void
  onBack: () => void
}

const MB = 1024 * 1024

/** time 以前で最も近いコマ（なければ最初のコマ） */
function frameAt(filmstrip: FilmstripFrame[], time: number): FilmstripFrame | undefined {
  let best = filmstrip[0]
  for (const f of filmstrip) {
    if (f.time <= time + 1e-6) best = f
    else break
  }
  return best
}

export function ExportScreen({ sources, results, chosen, pendingCount, exporter, cacheRef, busy, onBusyChange, onBack }: Props) {
  const totalSec = chosen.reduce((s, c) => s + (c.clip.end - c.clip.start), 0)
  const totalBytes = chosen.reduce(
    (s, c) => s + estimateClipBytes(c.clip, sources[c.source].file.size, sources[c.source].duration),
    0,
  )
  const frameAspect = results.find((r) => r)?.frameAspect ?? 1
  const multi = sources.length > 1

  return (
    <section className="export">
      <header className="bar">
        <button type="button" className="icon-button" onClick={onBack} disabled={busy} aria-label="編集に戻る" title="編集に戻る">
          <Icon name="back" />
        </button>
        <span className="export-total" title={`推定サイズ 約${Math.round(totalBytes / MB)}MB`}>
          {chosen.length}本・{formatDuration(totalSec)}
        </span>
        <span className="icon-button" aria-hidden="true" />
      </header>
      {pendingCount > 0 && (
        <p className="export-note" title="解析が終わった動画のクリップだけを保存します。解析が終わってから編集に戻って開き直すと加わります">
          解析中の{pendingCount}本は含まれません
        </p>
      )}

      <ul className="export-grid" style={{ ['--aspect' as string]: frameAspect }}>
        {chosen.map((c) => {
          const frame = frameAt(results[c.source]?.filmstrip ?? [], c.clip.start)
          const name = splitFileName(sources[c.source].file.name).base
          return (
            <li
              key={`${c.source}:${c.number}`}
              title={`${multi ? `${name} ` : ''}${formatDuration(c.clip.start)}〜${formatDuration(c.clip.end)}`}
            >
              {frame && <img src={frame.url} alt="" draggable={false} />}
              <span className="export-number">{multi ? `${c.source + 1}-${c.number}` : c.number}</span>
              <span className="export-length">{formatDuration(c.clip.end - c.clip.start)}</span>
            </li>
          )
        })}
      </ul>

      <ClipSaver sources={sources} chosen={chosen} exporter={exporter} cacheRef={cacheRef} onBusyChange={onBusyChange} />
    </section>
  )
}
