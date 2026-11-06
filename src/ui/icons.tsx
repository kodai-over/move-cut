// 画面で使う小さなアイコン（線のSVG）。色は文字色に合わせる
const paths = {
  back: 'M15 5l-7 7 7 7',
  close: 'M6 6l12 12M18 6L6 18',
  sliders: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 4v6M10 14v6',
  /** 選択ツール（矢印） */
  pointer: 'M6 4l12 7-5.5 1.5L10 18z',
  /** カットツール（はさみ） */
  scissors: 'M8.5 8.5L20 20M8.5 15.5L20 4M9 6.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM9 17.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  /** 書き出す（箱から上向きの矢印） */
  export: 'M12 15V4M8 8l4-4 4 4M5 13v6h14v-6',
} as const

export function Icon({ name }: { name: keyof typeof paths }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  )
}
