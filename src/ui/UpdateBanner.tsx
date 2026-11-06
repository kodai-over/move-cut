// Service Worker の状態のお知らせ：オフラインで使える準備ができたこと、新しいバージョンがあること
import { useRegisterSW } from 'virtual:pwa-register/react'

interface Props {
  /** 解析・書き出しの途中では更新（再読み込み）させない */
  canUpdate: boolean
}

export function UpdateBanner({ canUpdate }: Props) {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (needRefresh && canUpdate) {
    return (
      <div className="banner" role="status">
        <span>新しいバージョンがあります</span>
        <button type="button" className="banner-action" onClick={() => void updateServiceWorker(true)}>
          更新する
        </button>
      </div>
    )
  }
  if (offlineReady) {
    return (
      <div className="banner" role="status">
        <span title="ホーム画面に追加しておくと、しばらく使わなくても消えにくくなります">オフラインで使えます</span>
        <button type="button" className="banner-action" onClick={() => setOfflineReady(false)}>
          閉じる
        </button>
      </div>
    )
  }
  return null
}
