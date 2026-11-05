// 解析ロジックで使う型。UI・ブラウザAPIには依存しない

/** 関節1点（ピクセル座標） */
export interface Joint {
  x: number
  y: number
  /** 信頼度（MediaPipe の visibility、0〜1） */
  confidence: number
}

/** 1人分の骨格。MediaPipe Pose の33点を同じ順序で保持する */
export type Pose = Joint[]

export interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** 解析モード */
export type Mode = 'idea' | 'run'

/** 1フレーム分の観測値（フレーム取得ループで作る） */
export interface FrameObservation {
  /** 時刻（秒） */
  time: number
  /** 本人とみなした骨格（検出なし・見失い中なら null） */
  mainPose: Pose | null
  /** 直前フレームの本人と同一人物として追跡できたか。false のフレームは骨格スコアを計算しない */
  continuous: boolean
  /** 検出人数 */
  poseCount: number
  /** 差分スコア（先頭フレームなど算出できない場合は null） */
  diffScore: number | null
}

/** 採用したスコアの種別 */
export type ScoreSource = 'skeleton' | 'diff' | 'none'

/** 動きスコアの1行（CSV・グラフの元データ） */
export interface MotionSample {
  time: number
  skeletonScore: number | null
  diffScore: number | null
  /** 平滑化後の統合スコア */
  score: number
  source: ScoreSource
  /** 体幹の鉛直からの角度（度）。算出できない場合は null */
  trunkAngle: number | null
  poseCount: number
}
