// 解析中画面：進捗率と中止ボタン（画面を閉じると止まることは title で伝える）
interface Props {
  progress: number
  onCancel: () => void
}

export function AnalyzingScreen({ progress, onCancel }: Props) {
  const percent = Math.floor(progress * 100)
  return (
    <section className="analyzing" title="画面を閉じたり、他のアプリに切り替えたりすると止まります">
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
