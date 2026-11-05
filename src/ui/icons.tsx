// 画面で使う小さなアイコン（線のSVG）。色は文字色に合わせる
const paths = {
  back: 'M15 5l-7 7 7 7',
  close: 'M6 6l12 12M18 6L6 18',
  sliders: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 4v6M10 14v6',
} as const

export function Icon({ name }: { name: keyof typeof paths }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  )
}
