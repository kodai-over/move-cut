// 書き出し画面：残すクリップを並べて見せ、写真アプリに保存する
import { estimateClipBytes, type NumberedClip } from '../export/batch'
import type { FilmstripFrame } from '../video/analyzeVideo'
import type { SelectedVideo } from '../App'
import { ClipSaver } from './ClipSaver'
import { Icon } from './icons'
import { formatDuration } from './labels'
import type { RefObject } from 'react'
import type { ExporterQueue } from './useClipExporter'

interface Props {
  video: SelectedVideo
  duration: number
  chosen: NumberedClip[]
  filmstrip: FilmstripFrame[]
  frameAspect: number
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

export function ExportScreen({ video, duration, chosen, filmstrip, frameAspect, exporter, cacheRef, busy, onBusyChange, onBack }: Props) {
  const totalSec = chosen.reduce((s, c) => s + (c.clip.end - c.clip.start), 0)
  const totalBytes = chosen.reduce((s, c) => s + estimateClipBytes(c.clip, video.file.size, duration), 0)

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

      <ul className="export-grid" style={{ ['--aspect' as string]: frameAspect }}>
        {chosen.map((c) => {
          const frame = frameAt(filmstrip, c.clip.start)
          return (
            <li key={c.number} title={`${formatDuration(c.clip.start)}〜${formatDuration(c.clip.end)}`}>
              {frame && <img src={frame.url} alt="" draggable={false} />}
              <span className="export-number">{c.number}</span>
              <span className="export-length">{formatDuration(c.clip.end - c.clip.start)}</span>
            </li>
          )
        })}
      </ul>

      <ClipSaver
        video={video}
        duration={duration}
        chosen={chosen}
        exporter={exporter}
        cacheRef={cacheRef}
        onBusyChange={onBusyChange}
      />
    </section>
  )
}
