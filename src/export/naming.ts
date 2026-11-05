// 書き出すクリップのファイル名と形式。UI・ブラウザAPIに依存しない

/** 元ファイル名から拡張子を除いた部分と、小文字の拡張子（ドットなし）に分ける。拡張子がなければ mov とみなす */
export function splitFileName(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return { base: name, ext: 'mov' }
  return { base: name.slice(0, dot), ext: name.slice(dot + 1).toLowerCase() }
}

/** クリップのファイル名：`<元ファイル名>_<連番2桁>_<開始秒>s.<元の拡張子>`（例：IMG_1234_03_75s.mov）。index は1始まり */
export function clipFileName(sourceName: string, index: number, startSec: number): string {
  const { base, ext } = splitFileName(sourceName)
  return `${base}_${String(index).padStart(2, '0')}_${Math.floor(startSec)}s.${ext}`
}

/** 拡張子からMIMEタイプを決める。共有シートが動画として扱えるようにする */
export function videoMimeType(fileName: string): string {
  const { ext } = splitFileName(fileName)
  if (ext === 'mp4' || ext === 'm4v') return 'video/mp4'
  return 'video/quicktime'
}

/**
 * 再エンコードせずに区間を切り出す ffmpeg の引数。
 * - `-ss` を入力の前に置いてキーフレーム単位で高速にシークする（切り位置が数百ミリ秒ずれるのは仕様上許容）
 * - 映像1本と音声1本だけを残す（iPhoneの .mov に含まれるメタデータ用トラックはコピーできないことがあるため）
 * - 撮影日時などのメタデータは引き継ぐ
 */
export function cutArgs(input: string, output: string, startSec: number, endSec: number): string[] {
  const start = Math.max(0, startSec)
  const duration = Math.max(0, endSec - start)
  return [
    '-ss', start.toFixed(3),
    '-i', input,
    '-t', duration.toFixed(3),
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-map_metadata', '0',
    '-c', 'copy',
    '-avoid_negative_ts', 'make_zero',
    output,
  ]
}
