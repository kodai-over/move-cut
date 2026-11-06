// ffmpeg.wasm で元動画から区間を再エンコードせずに切り出す。
// 元動画は WORKERFS でマウントし、メモリに丸ごと複製せず必要な部分だけ読む。
// 複数の動画をまとめて扱うため、動画ごとに別のフォルダにマウントする（同じファイル名があってもぶつからないように）
import { FFFSType, FFmpeg } from '@ffmpeg/ffmpeg'
import { ASSETS } from '../config'
import { clipFileName, cutArgs, videoMimeType } from '../export/naming'
import { parseKeyframeTimes } from '../export/keyframes'
import type { Interval } from '../analysis/segment'
import { UserFacingError } from './videoFile'

const INPUT_DIR = '/input'

export interface ClipExporter {
  /** source 本目の動画から区間を切り出して File にする。index は1始まりの連番（ファイル名に使う） */
  exportClip(source: number, clip: Interval, index: number): Promise<File>
  /** source 本目の動画の映像のキーフレームの時刻（秒、昇順）。パケット情報だけを読み、映像はデコードしない */
  keyframeTimes(source: number): Promise<number[]>
  /** マウントを外し、ワーカーを終了する */
  dispose(): Promise<void>
}

/** アプリと同じオリジンに置いた ffmpeg コアの絶対URL（ワーカー内から読むため絶対URLにする） */
function assetUrl(path: string): string {
  return new URL(import.meta.env.BASE_URL + path, location.href).href
}

export async function createClipExporter(sources: readonly File[]): Promise<ClipExporter> {
  const ffmpeg = new FFmpeg()
  try {
    await ffmpeg.load({ coreURL: assetUrl(ASSETS.ffmpegCoreJs), wasmURL: assetUrl(ASSETS.ffmpegCoreWasm) })
  } catch (e) {
    console.error(e)
    ffmpeg.terminate()
    throw new UserFacingError('書き出し機能の読み込みに失敗しました。通信状況を確認して、もう一度お試しください。')
  }
  try {
    await ffmpeg.createDir(INPUT_DIR)
    for (let i = 0; i < sources.length; i++) {
      await ffmpeg.createDir(`${INPUT_DIR}/${i}`)
      await ffmpeg.mount(FFFSType.WORKERFS, { files: [sources[i]] }, `${INPUT_DIR}/${i}`)
    }
  } catch (e) {
    console.error(e)
    ffmpeg.terminate()
    throw new UserFacingError('動画ファイルを読み込めませんでした。')
  }
  const inputPath = (source: number) => `${INPUT_DIR}/${source}/${sources[source].name}`

  return {
    // ffmpeg.wasm の進捗イベントは入力全体の長さに対する割合で、区間の切り出しでは当てにならないため使わない
    async exportClip(source, clip, index) {
      const name = clipFileName(sources[source].name, index, clip.start)
      const code = await ffmpeg.exec(cutArgs(inputPath(source), name, clip.start, clip.end))
      if (code !== 0) throw new UserFacingError('動画の切り出しに失敗しました。')
      const data = await ffmpeg.readFile(name)
      // 書き出し後は ffmpeg 内のファイルを消してメモリを空ける
      await ffmpeg.deleteFile(name)
      if (typeof data === 'string') throw new UserFacingError('動画の切り出しに失敗しました。')
      // シングルスレッド版のため中身は通常の ArrayBuffer（SharedArrayBuffer ではない）
      return new File([data as Uint8Array<ArrayBuffer>], name, { type: videoMimeType(name) })
    },
    async keyframeTimes(source) {
      const out = 'keyframes.csv'
      // ffmpeg.wasm の ffprobe は成功しても終了コードが 0 にならないことがあるため、出力ファイルの中身で判定する
      await ffmpeg.ffprobe([
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'packet=pts_time,flags',
        '-of', 'csv=p=0',
        inputPath(source),
        '-o', out,
      ])
      let text = ''
      try {
        const data = await ffmpeg.readFile(out, 'utf8')
        text = typeof data === 'string' ? data : new TextDecoder().decode(data)
        await ffmpeg.deleteFile(out)
      } catch {
        // 出力がなければ下で失敗にする
      }
      const times = parseKeyframeTimes(text)
      if (times.length === 0) throw new UserFacingError('動画のキーフレームを読み取れませんでした。')
      return times
    },
    async dispose() {
      for (let i = 0; i < sources.length; i++) {
        try {
          await ffmpeg.unmount(`${INPUT_DIR}/${i}`)
        } catch {
          // 終了処理の失敗は無視してワーカーを止める
        }
      }
      ffmpeg.terminate()
    },
  }
}
