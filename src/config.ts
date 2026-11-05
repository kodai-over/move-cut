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
  /**
   * カメラ付近の判定：画面全体のうち、前フレームから変化した画素の割合がこれ以上なら「カメラのすぐ近くに人がいる」とみなす。
   * 撮影ボタンを押しに行く・カメラの前を通るときは画面の大部分が変わる。離れて踊っている間は実測で6%以下
   */
  nearCameraFrameDiff: 0.1,
  /** カメラ付近と判定したフレームの前後この秒数も、動きとして数えない */
  nearCameraMarginSec: 1.0,
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
  /** 切り出し区間の帯の色 */
  clipColor: 'rgba(47, 124, 246, 0.14)',
  /** フリーズ区間の帯の色 */
  freezeColor: 'rgba(255, 159, 28, 0.35)',
  /** 開始閾値（実線）・終了閾値（破線）の色 */
  thresholdColor: 'rgba(47, 124, 246, 0.7)',
  /** 終了閾値の破線の模様（線・間隔のpx） */
  endThresholdDash: [4, 3],
  /** スコア軸の上限を、開始閾値のこの倍率以上にする（閾値線が枠外に消えないように） */
  scoreAxisHeadroom: 1.2,
} as const

/** 区間の切り出し（ステップ2）のうち、スライダーで変えるパラメータ */
export interface SegmentParams {
  /** 開始閾値：スコアがこれを上回る状態が続いたら「動き開始」 */
  startThreshold: number
  /** 終了閾値：スコアがこれを下回る状態が区切り静止秒数続いたら「動き終了」 */
  endThreshold: number
  /** 区切り静止秒数 */
  stillSec: number
  /** 区間の前に付ける余白（秒） */
  marginBeforeSec: number
  /** 区間の後に付ける余白（秒） */
  marginAfterSec: number
  /** 間隔がこれ未満の隣接区間は1つにまとめる（秒） */
  mergeSec: number
  /** これ未満の区間は捨てる（秒） */
  minClipSec: number
}

/** 開始閾値の初期値。フェーズ1の実動画で静止 0.02〜0.06・ダンス 0.08〜0.18 だったため 0.08 とする */
const START_THRESHOLD = 0.08
/** 終了閾値は開始閾値のこの割合 */
const END_THRESHOLD_RATIO = 0.6

/** モード別のパラメータ初期値 */
export const SEGMENT_DEFAULTS = {
  idea: {
    startThreshold: START_THRESHOLD,
    endThreshold: START_THRESHOLD * END_THRESHOLD_RATIO,
    stillSec: 2.0,
    marginBeforeSec: 0.5,
    marginAfterSec: 0.7,
    mergeSec: 1.0,
    minClipSec: 1.5,
  },
  run: {
    startThreshold: START_THRESHOLD,
    endThreshold: START_THRESHOLD * END_THRESHOLD_RATIO,
    stillSec: 5.0,
    marginBeforeSec: 1.0,
    marginAfterSec: 1.0,
    mergeSec: 3.0,
    minClipSec: 3.0,
  },
} as const satisfies Record<'idea' | 'run', SegmentParams>

/** 区間の切り出しのうち、スライダーで変えない固定パラメータ */
export const SEGMENT = {
  /** 開始閾値を上回る状態がこの秒数続いたら「動き開始」 */
  startHoldSec: 0.3,
  /** フリーズ判定：静止の直前に動きを調べる秒数 */
  freezeLookbackSec: 1.0,
  /** フリーズ判定：直前の動きのピークに求める大きさ（開始閾値の倍率） */
  freezePeakRatio: 2,
  /** フリーズ判定：体幹の鉛直からの傾きの下限（度） */
  freezeMinTrunkDeg: 45,
  /** これより短い傾きはフリーズとみなさない（秒） */
  freezeMinSec: 0.5,
  /** フリーズとして区間に含める最大秒数 */
  freezeMaxSec: 5.0,
} as const

/** スライダーの範囲と刻み */
export const SLIDER = {
  threshold: { min: 0.005, max: 0.3, step: 0.001 },
  stillSec: { min: 0.5, max: 10, step: 0.5 },
  marginSec: { min: 0, max: 3, step: 0.1 },
} as const
