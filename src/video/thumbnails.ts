// クリップ一覧のサムネイルを作る（指定時刻のコマを縮小して画像URLにする）
import { EXPORT } from '../config'
import { createVideoElement, loadVideoInfo, prepareForFrameCapture, seekTo } from './videoFile'

/**
 * times の各時刻のサムネイルを順に作り、できたものから onEach で渡す。
 * signal で中止できる。失敗したコマは飛ばす（一覧の表示は止めない）
 */
export async function generateThumbnails(
  url: string,
  times: readonly number[],
  onEach: (index: number, dataUrl: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const video = createVideoElement(url)
  let detach: (() => void) | null = null
  try {
    const info = await loadVideoInfo(video)
    detach = await prepareForFrameCapture(video)
    const width = EXPORT.thumbnailWidth
    const height = Math.round((info.height / info.width) * width)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    for (let i = 0; i < times.length; i++) {
      if (signal?.aborted) return
      try {
        await seekTo(video, Math.min(Math.max(0, times[i]), info.duration))
        ctx.drawImage(video, 0, 0, width, height)
        onEach(i, canvas.toDataURL('image/jpeg', 0.7))
      } catch (e) {
        console.warn('サムネイルを作れませんでした', e)
      }
    }
  } catch (e) {
    console.warn('サムネイルを作れませんでした', e)
  } finally {
    detach?.()
    video.removeAttribute('src')
    video.load()
  }
}
