// アプリ全体のパラメータ。コード内に数値を直書きせず、ここに集約する

/** 解析（ステップ1：動きスコアの算出）のパラメータ */
export const ANALYSIS = {
  /** 解析のサンプリングレート（fps） */
  sampleFps: 10,
  /** 解析用に縮小するときの短辺（px）。元動画がこれより小さい場合は拡大しない */
  shortSidePx: 240,
  /** Pose Landmarker で検出する最大人数 */
  maxPoses: 2,
  /** 関節を「信頼できる」とみなす信頼度（visibility）の下限 */
  jointMinConfidence: 0.5,
  /** 骨格スコアを採用するのに必要な、信頼できる関節の最小数 */
  minReliableJoints: 6,
  /** 差分スコアで「変化あり」とみなすグレースケール画素差の下限（0〜255） */
  diffPixelThreshold: 25,
  /** 差分スコアの対象範囲を、直前の本人のバウンディングボックスから広げる割合（各辺、ボックス幅・高さ比） */
  diffRoiMargin: 0.25,
  /** 本人追跡：前フレームの本人と同一人物とみなすボックス中心の移動量の上限（前フレームのボックス対角線比） */
  trackMaxCenterShift: 0.8,
  /** 本人追跡：本人を見失ってから、最大の人物を本人として選び直すまでの秒数 */
  trackLostResetSec: 2.0,
  /** 本人追跡：選び直す人物に求める大きさ（最後に見た本人のボックス対角線比）。奥にいる小さな他人に乗り換えないため */
  trackReacquireMinSizeRatio: 0.5,
  /** 本人追跡：選び直しの基準にする本人の大きさの上限（画面対角線比）。カメラ直前で見失った場合でも、遠くに戻った本人を選べるようにする */
  trackReacquireRefMaxRatio: 0.3,
  /** 統合スコアを平滑化する移動平均の窓幅（秒） */
  smoothingWindowSec: 0.5,
  /** 1フレームのシークを待つ上限（ミリ秒）。超えたら解析失敗としてエラーを表示する */
  seekTimeoutMs: 5000,
} as const

/** 正式サポートする動画の範囲。超える場合は警告して続行を確認する */
export const SUPPORT = {
  /** 最大の長さ（秒） */
  maxDurationSec: 10 * 60,
  /** 最大解像度（短辺px）。4K（2160p）まで */
  maxShortSidePx: 2160,
} as const

/** モデル・WASM の配置先（public/ からの相対パス。scripts/fetch-assets.mjs が配置する） */
export const ASSETS = {
  poseModelPath: 'models/pose_landmarker_lite.task',
  mediapipeWasmDir: 'mediapipe',
} as const

/** ダウンロード用の Object URL を解放するまでの待ち時間（ミリ秒）。iOS Safari は即時解放すると保存に失敗することがある */
export const DOWNLOAD_URL_REVOKE_DELAY_MS = 10_000

/** グラフ表示 */
export const CHART = {
  /** 体幹角度の軸の最大値（度） */
  trunkAngleMaxDeg: 180,
} as const
