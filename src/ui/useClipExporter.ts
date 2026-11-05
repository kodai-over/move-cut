// 編集画面で ffmpeg.wasm を1つだけ使い回す。キーフレームの読み取りとクリップの書き出しを順番に実行する
// （同時に2つ動かすとiPhoneのメモリを圧迫するため）
import { useCallback, useEffect, useRef } from 'react'
import type { ClipExporter } from '../video/clipExporter'

export type RunWithExporter = <T>(task: (exporter: ClipExporter) => Promise<T>) => Promise<T>

export function useClipExporter(file: File): RunWithExporter {
  const exporterRef = useRef<Promise<ClipExporter> | null>(null)
  /** 前の処理が終わってから次を始めるための待ち行列の末尾 */
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())
  const disposedRef = useRef(false)

  // 画面を離れたらワーカーを終了する
  useEffect(() => {
    disposedRef.current = false
    return () => {
      disposedRef.current = true
      const pending = exporterRef.current
      exporterRef.current = null
      void pending?.then((ex) => ex.dispose()).catch(() => {})
    }
  }, [file])

  const getExporter = useCallback(() => {
    if (!exporterRef.current) {
      // ffmpeg.wasm は大きいので、最初に使うときに読み込む
      const created = import('../video/clipExporter').then(({ createClipExporter }) => createClipExporter(file))
      exporterRef.current = created
      // 読み込みに失敗したら、次に使うときにやり直せるようにする
      created.catch(() => {
        if (exporterRef.current === created) exporterRef.current = null
      })
    }
    return exporterRef.current
  }, [file])

  return useCallback<RunWithExporter>(
    (task) => {
      const result = queueRef.current.then(async () => {
        if (disposedRef.current) throw new DOMException('画面を離れました', 'AbortError')
        return task(await getExporter())
      })
      // 失敗しても後ろの処理は続ける
      queueRef.current = result.catch(() => {})
      return result
    },
    [getExporter],
  )
}
