// 解析中画面（1本目の解析が終わるまで）：進捗率と中止ボタン（画面を閉じると止まることは title で伝える）
interface Props {
  progress: number
  /** 解析中の動画（0始まり）と本数 */
  index: number
  total: number
  onCancel: () => void
}

export function AnalyzingScreen({ progress, index, total, onCancel }: Props) {
  const percent = Math.floor(progress * 100)
  return (
    <section className="analyzing" title="画面を閉じたり、他のアプリに切り替えたりすると止まります">
      {total > 1 && (
        <p className="analyzing-count">
          {index + 1} / {total}本目
        </p>
      )}
      <p className="percent" aria-live="polite">
        {percent}
        <small>%</small>
      </p>
      <progress value={progress} max={1} />
      <button className="button ghost" onClick={onCancel}>
        中止する
      </button>
    </section>
  )
}
