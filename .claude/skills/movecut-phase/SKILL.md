---
name: movecut-phase
description: MoveCutの開発フェーズ（docs/spec.mdの「開発フェーズ」）を実装するときの進め方。サブエージェントの使い方、レビュー強度、フェーズ完了時の報告手順を定める。フェーズの実装を始めるとき、または途中で並列化・レビューを判断するときに使用する。
---

# MoveCut フェーズ実装の進め方

## 1フェーズの流れ
1. `docs/spec.md` の該当フェーズと関連セクションを読む
2. `git-workflow` スキルに従いブランチを切る（例: `feat/phase1-motion-score`）。大きいフェーズは機能単位でブランチ・PRを分けてよい
3. 実装 → `npm test` と `npm run build` を通す → PR → `code-review`
4. マージ後、GitHub Pagesに反映されたことを確認し、作業を止めてユーザーに報告する
   - 報告内容: 実装したこと、iPhone実機での確認手順（Pages URL）、仮決め事項
   - 完了条件の判定はユーザーの実機確認で行う。自分で完了扱いにしない
5. ユーザーの確認が取れたらタグを打つ（フェーズNは `v0.N.0`）

## サブエージェント
- 基本は使わず、メインで順に実装する
- 並列化は編集ファイルが完全に分かれる場合のみ（例: `src/analysis/` の純粋関数＋テストと、UIコンポーネント）。先に共通の型と `src/config.ts` を `chore:` でコミットしてから起動する
- ライブラリの制約調査（iPhone SafariでのMediaPipe・ffmpeg.wasmの挙動など）は調査用エージェントに委譲し、結論だけ受け取る

## レビュー強度（code-review）
- 通常: `medium`
- フェーズ3の書き出し（ffmpeg.wasm・メモリ管理・共有）: `high`
- docs のみ: 省略
