// MediaPipe の WASM とPoseモデルを public/ に配置する（dev・build の前に自動実行）
// 実行時に外部CDNへ通信せず、アプリと同じオリジンから読み込むため
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = join(root, 'public')

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'
const MODEL_PATH = join(publicDir, 'models', 'pose_landmarker_lite.task')

const WASM_SRC = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
const WASM_DEST = join(publicDir, 'mediapipe')
const WASM_FILES = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

await mkdir(WASM_DEST, { recursive: true })
for (const f of WASM_FILES) {
  await copyFile(join(WASM_SRC, f), join(WASM_DEST, f))
}

if (!(await exists(MODEL_PATH))) {
  console.log('Poseモデルをダウンロード中…')
  const res = await fetch(MODEL_URL)
  if (!res.ok) throw new Error(`モデルのダウンロードに失敗しました: ${res.status}`)
  await mkdir(dirname(MODEL_PATH), { recursive: true })
  await writeFile(MODEL_PATH, Buffer.from(await res.arrayBuffer()))
}
console.log('アセットを配置しました')
