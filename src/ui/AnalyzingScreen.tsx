// 解析中画面：進捗率と「画面を閉じないで」の注意
interface Props {
  progress: number
  onCancel: () => void
}

export function AnalyzingScreen({ progress, onCancel }: Props) {
  const percent = Math.floor(progress * 100)
  return (
    <section className="screen analyzing">
      <p className="percent" aria-live="polite">
        {percent}
        <small>%</small>
      </p>
      <progress value={progress} max={1} />
      <p className="message warning">
        解析中です。画面を閉じたり、他のアプリに切り替えたりしないでください（処理が止まります）。
      </p>
      <button className="button secondary" onClick={onCancel}>
        中止する
      </button>
    </section>
  )
}
