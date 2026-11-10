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

別の設定で起動するときは `bun src/server/main.ts <設定ファイル>`（例 `bun src/server/main.ts /tmp/canvas.local.json`）。`canvas.config.json` のプレビューは 4301 番を使う。

### デモ（ゲーム 4 題と描画 5 題）

既定の設定は `fixtures/demo/recordings.json` も読むので、次の依頼にはそのまま答える（Grok Bot が制作担当を代行して作った固定応答）。ゲーム：「テトリスを作って」「オセロを作って」「インベーダーゲームを作って」「ソリティアを作って」。描画（Three.js・物理・HTML in canvas、本体は `examples/render/`）：「Three.js の場面を作って」「マーブルランを作って」「ピンボールを作って」「ブラックホールを作って」「HTML in canvas のカードを作って」。

入力せずに作品一覧へ入れるときは、検証ホストを起動したまま：

```sh
bun scripts/seed-demo.ts [設定ファイル]
```

同じ題名の作品があれば飛ばす。

### 作品一覧の共有（`singleUser`）

既定の設定（`"singleUser": true`、項目が無い場合も同じ）では、ブラウザごとに作品を分けない。`http://localhost:<hostPort>` を開いたどのブラウザにも `dataDir` の全作品が並ぶ。以前の版で別のブラウザから保存した作品も、再起動すれば一覧に出る。所有者ごとに分ける試験（plan.md の「別所有者による参照」）では `"singleUser": false` にする。

### 診断ログ

検証ホストは `<dataDir>/logs/` に JSON Lines を追記する（既定の設定では `.data/logs/`。`.data/` は git の対象外）。設定の `logDir` で場所を変えられる。各 5 MB を超えると `.1` に移して 1 世代だけ残す。

- `.data/logs/server.log`：ホストとプレビューの全要求（時刻・`server`・`pid`・待ち受け・メソッド・パス・状態・所要ミリ秒・`origin`・`sec-fetch-*`・拒否理由、500 のときはスタック）。本文・cookie・session・トークンは書かない。
- `.data/logs/client.log`：ホスト画面の診断イベント（例外、`console.error`、プレビュー接続、送信ボタン・`submit`・Enter、API の結果、実行状態、プレビュー起動）。依頼の本文は書かない（長さだけ）。

```sh
tail -f .data/logs/server.log .data/logs/client.log
```

検証ホストは `canvas.config.json` を読む。モデルの提供者は設定の `model` で選ぶ。現在は記録済み推論（`recorded`）だけを実装している。
