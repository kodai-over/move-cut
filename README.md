# MoveCut

ブレイキングの練習動画から「動いている区間」だけを自動で切り出すPWA。動画はすべて端末内で処理し、外部に送信しない。

- 公開URL: https://kodai-over.github.io/move-cut/
- 仕様: [docs/spec.md](docs/spec.md)

## ローカル起動

```bash
npm install
npm run dev
```

## iPhone実機での確認

- 基本は `main` マージ後に公開URLをSafariで開いて確認する（HTTPSのため共有シート等も動作する）
- 開発中に確認したい場合: Macと同じWi-FiのiPhoneで、`npm run dev` が表示する `Network:` のURLを開く（HTTPのため共有シート・Wake Lockは動かない）

## 仮決め事項

（仕様にない軽微な判断をここに記録する）
