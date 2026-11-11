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

入力せずに作品一覧へ入れる・最新の版にするときは、**検証ホストを止めたまま**：

```sh
bun scripts/seed-demo.ts [設定ファイル]
```

サーバーは起動しなくてよい。スクリプトの中で通常と同じ経路（記録済み推論 → 契約検査 → プレビュー観測 host-smoke → 必須検査の判定 → Store への保存）を実行し、設定の `dataDir`（既定 `.data/store.json`）に書いて終了する。観測のための一時的な待ち受けはループバックの空きポートだけで、設定のポート（4300・4301）は使わない。終了後に待ち受けも Chromium も残らない。

- 題名が無いデモ：新しい作品として保存する（r1）。
- 同じ題名があり、保存版と今の固定応答（本体・使うライブラリ・digest）が同じ：飛ばす。
- 同じ題名があり、中身が違う：同じ作品の新しい版として保存する（例 r1 → r2、通常の保存と同じく `expectedRevision` と受領キーで照合）。作品は増えない。古い版は版の履歴に残り、復元できる。

設定のホストポートで検証ホストが動いているときは、同じ `dataDir` に二つの書き込み手を付けないよう、何も書かずに止まる（終了コード 2）。表示どおりホストを止めてから実行し直す。

### 作品一覧の共有（`singleUser`）

既定の設定（`"singleUser": true`、項目が無い場合も同じ）では、ブラウザごとに作品を分けない。`http://localhost:<hostPort>` を開いたどのブラウザにも `dataDir` の全作品が並ぶ。以前の版で別のブラウザから保存した作品も、再起動すれば一覧に出る。所有者ごとに分ける試験（plan.md の「別所有者による参照」）では `"singleUser": false` にする。

独立版の更新前に作品と履歴を退避し、起動に失敗した場合は [更新と復旧の手順](docs/dependency-maintenance.md#独立版のデータを守って更新する) で元の状態へ戻せる。

### 診断ログ

検証ホストは `<dataDir>/logs/` に JSON Lines を追記する（既定の設定では `.data/logs/`。`.data/` は git の対象外）。設定の `logDir` で場所を変えられる。各 5 MB を超えると `.1` に移して 1 世代だけ残す。

- `.data/logs/server.log`：ホストとプレビューの全要求（時刻・`server`・`pid`・待ち受け・メソッド・パス・状態・所要ミリ秒・`origin`・`sec-fetch-*`・拒否理由、500 のときはスタック）。本文・cookie・session・トークンは書かない。
- `.data/logs/client.log`：ホスト画面の診断イベント（例外、`console.error`、プレビュー接続、送信ボタン・`submit`・Enter、API の結果、実行状態、プレビュー起動）。依頼の本文は書かない（長さだけ）。

```sh
tail -f .data/logs/server.log .data/logs/client.log
```

検証ホストは `canvas.config.json` を読む。既定の `model` は記録済み推論（`recorded`）。実モデルは別の設定ファイルで `provider: "openai-compatible"` と接続先・モデルを指定する。API キーは `apiKeyEnv` に環境変数の名前を書く。推論強度や出力トークン上限を指定する接続先では `reasoningEffort` と `maxCompletionTokens` を使える。

### 実モデルの計測と配布候補

`eval/p3/run.ts` の `--live-config` には、モデルの接続設定だけを入れた JSON を指定する。各反復は新しい実行ディレクトリを使う。実 API の呼び出し数と応答に含まれるトークン数は各実行の `host/usage.jsonl` に残る。

```sh
bun eval/p3/run.ts --cond D --suite heldout --run-dir eval/out/live/D-r1 --host-port 4740 --live-config /tmp/canvas-model.json --max-calls 42
bun eval/p3/grade.ts --root eval/out/live
bun run release:prepare
```

`bun run release:prepare` は一時的な作業コピーで依存の固定インストール、型検査、部分・結合試験、ブラウザ試験、配布物の検証を行う。合格した候補だけを `eval/out/dist/` に出力し、SHA-256 を添える。出力先を引数で指定できる。配布物の `canvas-package.json` に版、元の Git コミット、配布対象に未コミット変更があるか、同梱ファイルの SHA-256 を記録する。

展開先では同梱の `bun.lock` を使い、`bun install --frozen-lockfile` で依存を入れる。依存とブラウザの確認方法は [依存と配布物の保守](docs/dependency-maintenance.md) を参照。

`bun run verify:package` は配布候補を時刻をずらして2回作成し、同じバイト列になることを確認する。その後、ファイルの照合、展開先での固定インストール、ブラウザ観測、旧保存版の再表示・復元、Workerの停止を確認する。作成済みの候補を確認するときは引数に `.tgz` を渡す。必要な依存がローカルにある場合は `--offline` を指定できる。

Luna low の制作評価、ブラウザの確認、取込条件の進捗は [取り込み前の検証結果](docs/pre-integration-results.md) を参照。

### Interact での撮影と画像検証

[撮影の例](examples/interact/README.md)では、隔離したChromeで依頼を送り、候補のプレビューをPNGとして保存できます。画像を受け取れるモデルを指定すると、スクリーンショットを根拠に見た目の条件を判定できます。
