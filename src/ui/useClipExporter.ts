// 編集画面で ffmpeg.wasm を1つだけ使い回す。キーフレームの読み取りとクリップの書き出しを順番に実行する
// （同時に2つ動かすとiPhoneのメモリを圧迫するため）
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { ClipExporter } from '../video/clipExporter'

export interface ExporterQueue {
  /** ffmpeg.wasm を使う処理を順番待ちに並べて実行する */
  run<T>(task: (exporter: ClipExporter) => Promise<T>): Promise<T>
  /** 順番待ちが空になったら ffmpeg.wasm を終了してメモリを空ける（次に使うときに読み込み直す） */
  release(): void
}

export function useClipExporter(file: File): ExporterQueue {
  const exporterRef = useRef<Promise<ClipExporter> | null>(null)
  /** 前の処理が終わってから次を始めるための待ち行列の末尾 */
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())
  /** 順番待ち・実行中の処理の数 */
  const pendingRef = useRef(0)
  const disposedRef = useRef(false)

  const disposeExporter = useCallback(() => {
    const current = exporterRef.current
    exporterRef.current = null
    void current?.then((ex) => ex.dispose()).catch(() => {})
  }, [])

  // 画面を離れたらワーカーを終了する
  useEffect(() => {
    disposedRef.current = false
    return () => {
      disposedRef.current = true
      disposeExporter()
    }
  }, [file, disposeExporter])

  const getExporter = useCallback(() => {
    if (!exporterRef.current) {
      // ffmpeg.wasm は大きいので、使うときに読み込む
      const created = import('../video/clipExporter').then(({ createClipExporter }) => createClipExporter(file))
      exporterRef.current = created
      // 読み込みに失敗したら、次に使うときにやり直せるようにする
      created.catch(() => {
        if (exporterRef.current === created) exporterRef.current = null
      })
    }
    return exporterRef.current
  }, [file])

  const run = useCallback<ExporterQueue['run']>(
    (task) => {
      pendingRef.current += 1
      const result = queueRef.current
        .then(async () => {
          if (disposedRef.current) throw new DOMException('画面を離れました', 'AbortError')
          try {
            return await task(await getExporter())
          } catch (e) {
            // メモリ不足などで ffmpeg.wasm が壊れていることがあるので、次は読み込み直す
            disposeExporter()
            throw e
          }
        })
        .finally(() => {
          pendingRef.current -= 1
        })
      // 失敗しても後ろの処理は続ける
      queueRef.current = result.catch(() => {})
      return result
    },
    [getExporter, disposeExporter],
  )

  const release = useCallback(() => {
    // いま並んでいる処理が終わってから確かめる（その間に新しい処理が並んだら終了しない）
    void queueRef.current.then(() => {
      if (pendingRef.current === 0) disposeExporter()
    })
  }, [disposeExporter])

  return useMemo(() => ({ run, release }), [run, release])
}
