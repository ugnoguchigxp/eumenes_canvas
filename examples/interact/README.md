# Interact で Canvas の候補を撮影する

隔離した Google Chrome を開き、Canvas の制作画面に依頼を送って、表示された候補のプレビューを撮影します。撮影には eumenes-interact 0.1.4 と、その Playwright MCP アダプターを使います。

```sh
bun install --frozen-lockfile
bun install --cwd examples/interact --frozen-lockfile --ignore-scripts
bun examples/interact/run.ts --request 'テトリスを作って'
```

Bun 1.4.4、Google Chrome、Canvas が必須検査に使う Playwright Chromium が必要です。必要に応じて `bunx playwright install chromium` で Chromium を入れてください。既定では Canvas の固定応答を使います。実モデルや登録データで試す場合は `--canvas-config canvas.local.json` を指定します。設定のファイル参照は Canvas リポジトリのルートから解決します。

実行ごとにループバック上の空きポートとメモリ上の作品ストアを使います。PNG と `report.json` は `eval/out/interact-*/` に残ります。新しい出力先を明示する場合は `--out <ディレクトリ>` を指定します。ブラウザと一時ホストは終了時に閉じます。

## 画像から見た目を確認する

画像を受け取れる Chat Completions 互換の接続先を JSON で指定します。次の例は Canvas の固定応答で作品を作り、撮影したPNGと確認条件を画像判定の接続先へ送ります。

```sh
bun examples/interact/run.ts \
  --request 'テトリスを作って' \
  --vision-config /path/to/vision.json \
  --verify '黒い盤面と、右側の次のピースが見える。'
```

`vision.json` は `baseUrl`、`model`、必要に応じて `apiKeyEnv`、`maxCompletionTokens`、`timeoutMs` を指定します。キーは環境変数から読みます。判定の呼び出しは1回です。結果は `pass`、`fail`、`unknown` のいずれかと、画像上の根拠を返します。静止画で確認できない操作や内部状態は `unknown` として扱うよう指示します。上の撮影と判定だけの例では、`fail` または `unknown` の終了コードは2です。PNGのファイル名、寸法、ハッシュ、判定結果は同じ `report.json` から確認できます。

## 修正して同じ操作を再生する

```sh
bun examples/interact/run.ts \
  --canvas-config canvas.local.json \
  --request 'Spaceを押すとマーカーが右へ移動し、黄色に変わる作品を作って' \
  --vision-config /path/to/vision.json \
  --verify 'Spaceを押したあとの画面の右半分に黄色いマーカーが見える。' \
  --repair --key Space
```

`--repair` は最初のPNGに対する独立判定を1回行います。判定が `fail` なら、候補を例専用のメモリストアに保存し、観測と確認条件を通常の修正依頼として送ります。修正後の候補は手動時計と同じ乱数シードで起動し、同じキー操作を再生して撮影します。このモードでは設定ファイル側の任意の検証担当を無効にして、独立判定の上限を守ります。修正後の判定は画像を開いて確認できます。

`--key` は複数指定できます。各候補で作品面の中央をクリックし、指定順にキーを短く押します。キーなしなら両方とも起動直後の画像です。この例はキーを押し続ける操作や時間の進行を含みません。出力の `image` と `imageAfter` が前後のPNGです。`report.json` に操作順、最初の判定、修正後の撮影結果と画素の一致有無が残ります。`repair.status: "replayed"` は再生・撮影の完了を示します。修正後の合否には追加のモデル判定を行いません。`pass` や `unknown` では修正を送りません。

既知の色の不具合を使って、前後の画像と判定回数を検査できます。

```sh
bun examples/interact/check-repair.ts
bun examples/interact/check-repair.ts --live
```

通常は固定応答を使います。`--live` は `OPEN_AI_API_KEY` を読み、最初の不具合入り候補を固定した上で、Luna low の独立判定1回と制作の修正1回を実行します。実モデルの応答モデル名とHTTP状態は `provider-calls.json` に残ります。

採点用に作品のコードも保存する場合は `--archive` を指定します。通常の確認保存を経た候補を `before.json` と `after.json` に出し、対応するPNGのハッシュを記録します。編集・修復の開始版は `--base <作品JSON>` で使い捨てのストアに置けます。実モデルの比較手順は [未使用課題での画像修正の比較](../../docs/vision-repair-evaluation.md) にあります。

## 依存の版

- eumenes-interact 0.1.4、ソース `cdd7bdff5184bc0396fbdf1cbdd7e8d3763b75c1`、同梱tgzのSHA-256 `dbe6f4d415970dd9f7e48425f47fc7d0e044673c08f05ea9c64b3ec6bc8b5c25`
- Playwright MCP 0.0.83
