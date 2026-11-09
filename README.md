# eumenes_canvas

会話で Canvas 2D の小さなアプリを作り、その場で操作・修正・保存する独立サブプロジェクト。設計は [design.md](design.md)、実装計画は [plan.md](plan.md)、段階ごとの結果は `docs/` にある。

## 必要なもの

- Bun 1.4.4
- Playwright のブラウザ：`bunx playwright install chromium webkit`
  - Linux で WebKit の依存ライブラリが足りない場合は `bunx playwright install-deps webkit`（root が必要）。

## 実行

```sh
bun install
bun run dev                # 検証ホスト http://localhost:4300 （プレビューは http://127.0.0.1:4301）
bun run test:unit          # Bun の部分・結合試験
bun run test:e2e           # Playwright（Chromium・WebKit）
bun run verify             # 型検査 → 部分・結合 → Playwright
bun run eval:p2            # P2 の評価（記録済み推論）。結果は eval/out/ に出る
```

検証ホストは `canvas.config.json` を読む。モデルの提供者は設定の `model` で選ぶ。現在は記録済み推論（`recorded`）だけを実装している。
