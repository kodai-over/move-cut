// ffmpeg.wasm で元動画から区間を再エンコードせずに切り出す。
// 元動画は WORKERFS でマウントし、メモリに丸ごと複製せず必要な部分だけ読む
import { FFFSType, FFmpeg } from '@ffmpeg/ffmpeg'
import { ASSETS } from '../config'
import { clipFileName, cutArgs, videoMimeType } from '../export/naming'
import type { Interval } from '../analysis/segment'
import { UserFacingError } from './videoFile'

const INPUT_DIR = '/input'

export interface ClipExporter {
  /** 区間を切り出して File にする。index は1始まりの連番（ファイル名に使う） */
  exportClip(clip: Interval, index: number): Promise<File>
  /** マウントを外し、ワーカーを終了する */
  dispose(): Promise<void>
}

/** アプリと同じオリジンに置いた ffmpeg コアの絶対URL（ワーカー内から読むため絶対URLにする） */
function assetUrl(path: string): string {
  return new URL(import.meta.env.BASE_URL + path, location.href).href
}

export async function createClipExporter(source: File): Promise<ClipExporter> {
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
    await ffmpeg.mount(FFFSType.WORKERFS, { files: [source] }, INPUT_DIR)
  } catch (e) {
    console.error(e)
    ffmpeg.terminate()
    throw new UserFacingError('動画ファイルを読み込めませんでした。')
  }
  const inputPath = `${INPUT_DIR}/${source.name}`

  return {
    // ffmpeg.wasm の進捗イベントは入力全体の長さに対する割合で、区間の切り出しでは当てにならないため使わない
    async exportClip(clip, index) {
      const name = clipFileName(source.name, index, clip.start)
      const code = await ffmpeg.exec(cutArgs(inputPath, name, clip.start, clip.end))
      if (code !== 0) throw new UserFacingError('動画の切り出しに失敗しました。')
      const data = await ffmpeg.readFile(name)
      // 書き出し後は ffmpeg 内のファイルを消してメモリを空ける
      await ffmpeg.deleteFile(name)
      if (typeof data === 'string') throw new UserFacingError('動画の切り出しに失敗しました。')
      // シングルスレッド版のため中身は通常の ArrayBuffer（SharedArrayBuffer ではない）
      return new File([data as Uint8Array<ArrayBuffer>], name, { type: videoMimeType(name) })
    },
    async dispose() {
      try {
        await ffmpeg.unmount(INPUT_DIR)
      } catch {
        // 終了処理の失敗は無視してワーカーを止める
      }
      ffmpeg.terminate()
    },
  }
}
