# 11 制作担当のハーネス：脱線させずに成功率を上げる仕組み

2026-11-11 作成。対象は `main`（commit `9236612`。必須の観測は host-smoke/3）。

## 1. 目的

制作担当（1 回の推論で作品を書く担当）の成功率を、**推論を足さずに**上げる。弱いモデルでも脱線せず、強いモデルならより多くを使える仕組みを、ホスト側に作る。

これまでに足した検証（検証担当の判定、操作の再生、画像による修正）は、合格率の上積みを測れなかった（[取り込み前の検証結果](../pre-integration-results.md)、[操作の再生](../replay-comparison.md)、[画像修正](../vision-repair-evaluation.md)）。効いたのは、契約の明示・制作手順・観測器の偽陰性の修正だった。この冊は後者の方向を進める。モデルの設定（推論強度など）と、LLM による判定役は扱わない。

### 1.1 考え方

| 段 | 内容 | この冊の節 |
| --- | --- | --- |
| 既定の道 | 従えば罠を踏まない形を、契約の最初の例にする。強制はしない | 5 |
| 差し替え | 普通の Web の書き方をそのまま書かせ、ホストが再現性のある実装に載せ替える | 6 |
| すぐ分かる | 書いた誤りを、ブラウザで動かす前に、行と理由つきで機械が返す | 3・4 |
| 自分で確かめる | 制作担当が数値の期待を宣言し、ホストが測って突き合わせる | 8 |
| 宣言して使う | Canvas の外に出る操作（保存）は、宣言し、ホストが仲介する | 9 |
| 止める | 任意の通信、外部コードの読み込み、親画面へのアクセス。今の隔離のまま | — |

禁止を増やす冊ではない。止めるのは今の隔離が止めているものだけで、それ以外は「楽な道を用意する」「裏で差し替える」「宣言させる」のどれかにする。

### 1.2 弱いモデルと強いモデル

| 仕組み | 弱いモデルでの効き方 | 強いモデルでの伸び方 |
| --- | --- | --- |
| 静的検査（4） | 行つきの誤りが実行前に返る | 型定義を読んで初回から正しく書く |
| 標準形（5） | 枠を埋めるだけで罠を踏まない | 必要なら `frame` の形で外れられる |
| 差分出力（7） | 書く量が減り、壊す範囲が狭い | 大きい作品に複数箇所の変更を入れられる |
| 期待値の照合（8） | 一番数値的な要件を 1 つ宣言する | 手順つきの期待を多数書ける |
| 保存（9） | 宣言されたコレクションだけの小さな API に見える | 複数のコレクションを組み合わせる |

### 1.3 進め方

1. 節 2（測る土台）を最初に作る。
2. 節 3〜10 を上から順に、**1 つずつ**足す。各節は設定で有効にしたときだけ動く。既定はすべて無効で、無効のときの動作は今と同じ（[README](README.md) 規則 2）。
3. 各節は、まず推論なしで確かめる（節 2 の対照の作品集で、誤検出 0 と検出率）。次に調整用の課題で、段階別の集計がどこで動いたかを見る。動かなければ既定を無効のままにし、理由を結果の文書に書く。
4. [README](README.md) の規則 1〜10 はこの冊でも変えない。特に、保存の必須条件（契約・起動・操作）は変えない。

設定は `CanvasConfig`（`src/server/main.ts`）と `ServiceOptions`（`src/core/service.ts`）に 1 つの項目 `harness` として足す。

```ts
harness?: {
  lint?: "off" | "advise" | "enforce"; // 節 4。既定 "off"
  virtualGlobals?: boolean;             // 節 6。既定 false
  edits?: boolean;                      // 節 7。既定 false
  storage?: "off" | "maker" | "given";  // 節 9。既定 "off"
};
```

期待値の照合（節 8）は既存の設定 `review.mode` に値 `"expect"` を足す。出力の形（節 3）は既存の `model.format` を使う。

## 2. 測る土台（推論を使わない）

### 2.1 目的

仕組みを足すたびに「正しい作品を誤って止めないか」「誤りを見つけるか」を、モデルを呼ばずに測れるようにする。P3 では観測器の偽陰性だけで正しい候補が 10 件落ちた。同じことを新しい仕組みで起こさない。

これまでの比較は、基準版が 36/36 の課題や 3 反復の差 1 件で、効果を読めなかった。合否 1 つではなく、**試行が最初に落ちた段階**を数える。

### 2.2 触るファイル

| 種類 | ファイル | すること |
| --- | --- | --- |
| 新規 | `eval/harness/corpus.ts` | 正しい作品の一覧を作る |
| 新規 | `eval/harness/mutate.ts` | 正しい作品に既知の誤りを注入する |
| 新規 | `eval/harness/self-test.ts` | 仕組みごとの誤検出と検出率を出す |
| 新規 | `eval/harness/stage.ts` | 試行が最初に落ちた段階を決める |
| 新規 | `eval/tasks/harness-dev.json`・`eval/checks/harness-dev.ts`・`eval/gold/harness-dev/`・`eval/bases/harness-dev/` | 調整用の課題 |
| 新規 | `docs/eval/harness-dev.md` | 調整用の課題の文と判定の方針 |
| 新規 | `tests/unit/harness-corpus.test.ts` | 単体試験 |
| 新規 | `tests/e2e/budget-advance.spec.ts` | 実行上限の誤作動の確認（2.6） |

触らない：`eval/checks/` の既存ファイル、`eval/gold/` の既存ディレクトリ、`eval/tasks/` の既存 JSON、`eval/recordings/`、`docs/eval/` の既存ファイル（規則 6）。`src/` から `eval/` を import しない（規則 5）。

### 2.3 対照の作品集

**正しい作品（誤検出の対照）。** 次を読むだけで使う。

- `eval/gold/general/*.js`（8 本）、`eval/gold/render/*.js`（6 本）
- `examples/render/*.js`（5 本）、`fixtures/demo/artworks/*.js`（4 本）
- `fixtures/p1/artworks/` のうち、記録の中で保存に進む作品

`eval/bases/` は不具合を入れた元作品を含むので使わない。`libraries` の宣言が要る作品は、`fixtures/demo/recordings.json` と各 suite の課題 JSON から対応を取る。

**変異（検出の対照）。** `eval/harness/mutate.ts` が TypeScript の構文木で、正しい作品 1 本につき次を 1 つずつ注入する。注入できる箇所が無い作品は、その変異を飛ばす。

| id | 注入する誤り | 見つける仕組み |
| --- | --- | --- |
| `undefined-name` | 最初の描画より後に実行される分岐の中の識別子 1 つを、末尾に `_x` を付けた未宣言の名前に変える | 静的検査 |
| `start-twice` | 作品の末尾に `canvasApp.start(() => ({}));` を足す | 静的検査 |
| `unknown-handler` | 返すオブジェクトの `frame`（または `draw`）を `render` に変える | 静的検査 |
| `key-as-code` | `.key` と `" "` の比較を `.key` と `"Space"` の比較に変える | 静的検査 |
| `api-typo` | `api.width` の 1 か所を `api.widht` に変える | 静的検査 |
| `sign-flip` | 数値の期待を書いた作品で、速度の加算 1 か所の符号を反転する | 期待値の照合 |
| `double-convert` | 同、`dt / 1000` の 1 か所を `dt / 1000 / 1000` に変える | 期待値の照合 |
| `half-speed` | 同、速度の定数 1 つを半分にする | 期待値の照合 |

下の 3 つは、節 8 で期待を手で書いた 4 本にだけ注入する。

### 2.4 自己確認（`eval/harness/self-test.ts`）

```sh
bun eval/harness/self-test.ts [--port <空きポート>] [--out eval/out/harness/self-test.json]
```

- 仕組みごとに、正しい作品での指摘の数（誤検出）と、変異ごとの検出数を出す。
- **合格の条件：正しい作品での指摘が 0 件**（重い指摘も軽い指摘も）。0 件にならない規則は、制作担当に返す前に外すか狭める。規則を足して 0 件に合わせない。
- 検出率は記録する。目安は 9 割。届かない変異は、理由を結果の文書に書く。
- 静的検査だけの確認はブラウザを使わない。期待値の照合の確認は、既存の評価と同じく一時の待ち受けと Chromium を使う。

### 2.5 段階別の集計（`eval/harness/stage.ts`）

試行（1 課題 1 反復）の最後の候補について、最初に落ちた段階を 1 つ決める。

| 段階 | 決め方 |
| --- | --- |
| `form` | 推論の応答が形の検査に通らず、候補ができなかった |
| `contract` | 検証記録の `contract` が不合格 |
| `lint` | 静的検査の重い指摘が残った（節 4 が有効なとき） |
| `boot` | `loaded` が不合格 |
| `runtime` | `no-runtime-error` が不合格 |
| `responds` | `not-blank` か `responds` が不合格 |
| `expect` | 期待値の食い違いが残った（節 8 が有効なとき） |
| `grade` | 提示・保存できたが、固定の採点で不合格 |
| `pass` | 固定の採点に合格 |

あわせて、試行ごとに「形の出し直しの回数」（制作の API 呼び出しの数 − サービスの試行数）と「修正の回数」を出す。入力は `eval/p3/run.ts` が書く `host/results.json`・`host/usage.jsonl` と採点の結果。`TaskRecord` に足りない項目（最後の候補の検証記録の `checks`）は、`eval/p3/run.ts` の記録に**足す**（既存の項目は変えない）。

### 2.6 実行上限の誤作動の確認

`src/preview/execution-budget.js` の上限は「同じタスクで最初のループから実時間 750ms」だった。`src/preview/bootstrap.js` の `advance` は進めた時間のぶんの `frame` を 1 つのタスクで回す。観測の `advance(1000)` は約 63 回、`HarnessSession` の 2000ms 刻みは 125 回になる。1 回の `frame` が実時間で約 12ms（後者は約 6ms）を超える作品は、正しくても「ループが 750ms 以内に制御を返さなかった」で止まった。

**2026-11-11 に再現して直した（偽の Worker 環境の単体試験）。** 1 回約 20ms のループを持つ `frame` を `advance(1000)` で動かすと、約 750ms の時点（37 回目あたり）で打ち切られ、エラーが出た。

- 直し方：`execution-budget.js` に期限を消す関数 `__canvasResetExecution` を足し、`bootstrap.js` の `call(name, args)` が作品の関数を呼ぶ直前に呼ぶ。上限は「作品の関数 1 回の呼び出しあたり 750ms」になった。一度上限に当たった作品は、今までどおり以後も止まる。
- ページ直接モード（`src/preview/page-runtime.js` の観測用の時計の `call`）にも同じ変更を入れた。**こちらは実ブラウザで確かめていない。**
- 作品の最上位のコードと setup は `call` を通らないので、今までどおりタスク単位で数える。
- 1 つの `advance` の合計時間の上限は、ホストの画面の `advance` の待ち（10 秒、`src/host/preview-client.js`）が受け持つ。
- 試験：`tests/unit/bootstrap.test.ts` に 2 件（遅くないフレームの合計で止めない／1 回の `frame` の中の長いループは止める）。

残り：実ブラウザでの確認。`tests/e2e/budget-advance.spec.ts` を足す。

- 作品：`frame` の中で、実時間 15ms を使うループを 1 つ回して描く（`performance.now()` で測って抜ける）。
- `advance(1000)` のあと、`events` に `"ループが 750ms"` を含むエラーが無いこと。
- `tests/e2e/p0-threats.spec.ts` と `tests/e2e/page-mode.spec.ts` の「無限ループ」の試験がそのまま通ること。

### 2.7 調整用の課題（harness-dev）

改善の調整に使ってよい課題。**取込の判定（plan.md §4）には使わない。** 判定用の未使用課題は、評価担当が別に凍結する。

| 群 | 数 | 狙い |
| --- | ---: | --- |
| 数値の導出（新規） | 4 | 跳ぶ高さ、水平の速さ、落下の速さ、周期。[Luna low の不合格原因](../luna-low-quality-review.md) の種類 |
| 維持つきの変更（複数ターン） | 2 | 前のターンの変更を保ったまま別の点を変える |
| 大きい基準作品の変更 | 3 | 基準作品が約 10KB・20KB・30KB。`fixtures/demo/artworks/` と `examples/render/` の写しを `eval/bases/harness-dev/` に置く |
| 保存あり | 3 | 節 9 のあとに足す |

general-v1 と同じ形にする：課題文と判定の方針を `docs/eval/harness-dev.md` に書き、参照作品と不合格の対照で判定が期待どおりに割れることを確かめてから使う。判定は画素の観測だけで行う。

### 2.8 試験と完了の確認

`tests/unit/harness-corpus.test.ts`：正しい作品の一覧が 20 本以上あること。各変異が、対応する小さな作品に対して注入前後で本文が変わり、注入後も構文エラーにならないこと（`start-twice` を除く）。`stage.ts` が上の表の各段階を、作った入力から決めること。

```sh
bun run typecheck
bun test tests/unit/harness-corpus.test.ts
bunx playwright test tests/e2e/budget-advance.spec.ts --project=chromium
bun run verify
```

## 3. 出力の経路を固める

### 3.1 目的

形の不備で試行を失わない。作品のコードを JSON の文字列に包ませない。

実測に使った接続の設定（`eval/out/luna-quality-2026-11-11/luna-config.json`）には `format` が無く、既定の `"json"` だった。エスケープしない形 `"fenced"` は `src/server/http-channel.ts` に実装済みで、比較の結果はまだ無い。

### 3.2 触るファイル

| 種類 | ファイル | すること |
| --- | --- | --- |
| 変える | `src/server/http-channel.ts` | 打ち切りの検出、一時的な失敗の再試行 |
| 変える | `tests/unit/http-channel.test.ts` | 試験を足す |

### 3.3 仕様

1. **打ち切り。** `post` は応答の `choices[0].finish_reason` も読む。`"length"` のときは `"出力が上限で打ち切られた"` の例外にする。`complete` はこの例外を形の出し直しの対象にしない（同じ条件で出し直しても同じ結果になるため）。
2. **一時的な失敗。** 状態が 429・500・502・503・504 のときは、1000ms・3000ms 待って最大 2 回やり直す。`signal` が中断されたら待たずに終える。待ちの合計は `timeoutMs` に含めない。定数は `HTTP_RETRY_STATUS`・`HTTP_RETRY_WAITS_MS`。
3. **`fenced` の比較。** 調整用の課題で `format: "json"` と `"fenced"` を同じ反復数で測り、段階 `form` と `contract`（構文エラー）の数を比べる。悪くならなければ、実モデルの設定の例（README の説明）を `"fenced"` にする。`HttpChannel` の既定値は変えない。

記録済みの応答で確かめた範囲では、126 応答すべてが `finish_reason: "stop"` で、出力は最大 2,139 トークンだった。打ち切りは今は起きていない。節 7 で大きい作品を扱うと起きうる。

### 3.4 試験

| 試験 | 入力 | 期待 |
| --- | --- | --- |
| 打ち切り | `finish_reason: "length"` の応答 | 例外の文が `出力が上限で打ち切られた` を含み、要求は 1 回だけ |
| 一時的な失敗 | 503 → 503 → 200 | 3 回目の応答を返す |
| 続く失敗 | 503 が 3 回 | 例外。要求は 3 回 |
| 中断 | 1 回目の 429 のあとに `signal` を中断 | `aborted` の例外。要求は 1 回 |

待ち時間は試験で差し替えられるようにする（`deps.sleep`）。

## 4. 静的検査 host-lint/1

### 4.1 目的

ホスト観測は起動から約 2 秒ぶんしか作品を動かさない。終了・やり直しなど、その間に通らない分岐の誤りは今は見つからない。実行する前に、確実に壊れる誤りを行と理由つきで返す。

### 4.2 触るファイル

| 種類 | ファイル | すること |
| --- | --- | --- |
| 新規 | `src/contract/artwork-api.ts` | 契約の API の型定義の文を作る関数 |
| 新規 | `src/core/lint.ts` | 検査の本体 |
| 変える | `src/core/service.ts` | 契約の検査のあとに呼ぶ |
| 変える | `src/core/types.ts`・`src/core/review.ts` | 観測の種類 `lint`、指摘の出所 `lint` を足す |
| 変える | `src/core/prompt-maker.ts` | 指摘の見出し |
| 新規 | `tests/unit/lint.test.ts` | 単体試験 |

### 4.3 仕様

**型定義（`artworkApiTypes(body): string`）。** 契約の文書と同じ内容を、TypeScript の宣言の文にする。

- `CanvasApi`：`canvas`・`ctx`（`OffscreenCanvasRenderingContext2D`）・`canvas3d`・`width`・`height`・`dpr`・`data`（`any`）・`random()`・`status(value)`・`decodeSVG(svg)`。
- `CanvasHandlers`：`frame`・`update`・`draw`・`input`・`resize`。すべて任意。
- 入力イベントは **1 つの型**にまとめ、`type` 以外の項目はすべて任意にする。判別できる共用体にすると、`type` を見ずに `ev.code` を読む正しい作品が誤検出になる。
- `THREE`・`CANNON` は `any`（宣言したライブラリだけ）。

**検査の作り方。** `typescript`（既に依存にある。`src/server/instrument-loops.ts` が使っている）で、メモリ上の 2 つのファイル（型定義と作品）からプログラムを作る。

- 作品は、配信と同じ形の関数で包む：先頭に、引数の型を書いた JSDoc の行、`(function (canvasApp, …) {`、`"use strict";` を置く。行のずれは `src/server/preview.ts` の `assembleWorkerScript` と同じ数え方（包んだ頭の改行の数）で引く。
- オプション：`allowJs`・`checkJs`・`noEmit`、`strict` は偽、`lib` は `es2022` と `webworker`、`types` は空。
- 標準ライブラリのファイルは 1 回だけ読んで保持する。検査が 3 秒を超えた・例外を出したときは、指摘なしとして扱う（候補の失敗にしない）。

**規則。** 各指摘は `{ rule, severity, line, column, message }`。`line`・`column` は作品の行と列。文は `locate.ts` と同じ形で終える：`…（作品の N 行 M 列）`。制作担当に返すときは `withSourceLine` で該当行を足す。

| rule | severity | 条件 | 文 |
| --- | --- | --- | --- |
| `start-count` | error | `canvasApp.start(` の呼び出しが 1 個でない | `canvasApp.start の呼び出しが N 個ある（1 個だけにする）` |
| `no-handler` | error | setup が返すオブジェクトの直書きに `frame`・`update`・`draw` のどれも無い | `frame（または update・draw）が無いので何も描かれない` |
| `undefined-name` | error | 診断 2304・2552（名前が見つからない） | `<名前> は宣言されていない` |
| `api-property` | error | 診断 2339 のうち、型が `CanvasApi`・`OffscreenCanvasRenderingContext2D`・`OffscreenCanvas`・節 9 の保存の型のもの | `<型> に <名前> は無い` |
| `unknown-handler` | warn | 返すオブジェクトの直書きに、上の 5 つ以外の名前の関数がある | `<名前> は呼ばれない。呼ばれるのは frame・update・draw・input・resize` |
| `key-compare` | warn | `.key` を `"Space"`・`Key[A-Z]`・`Digit[0-9]` と比べている、または `.code` を 1 文字の文字列と比べている | `ev.key は " " や "r"、ev.code は "Space" や "KeyR"` |

採用する診断はこの表のものだけ。ほかの診断（型の不一致、引数の数など）は捨てる。`Math.random`・`Date.now`・`setTimeout` の使用は指摘しない（節 6 で差し替える）。

**サービスへの組み込み（`execute`）。** 契約の検査に通った候補に対して呼ぶ。ホスト観測は従来どおり行う。

- `"advise"`：指摘を検証記録に `{ id: "lint:<rule>", level: "advisory", pass: false, detail }` として残す。制作担当には、その候補がホスト観測に落ちて出し直すときだけ、観測の文と一緒に返す。
- `"enforce"`：`error` の指摘を、検証の重い指摘（`blocking`）と同じ扱いにする。必須の検査に通った候補は提示の候補に残し、試行が残っていれば指摘を返して直させる。提示の選び方は今の規則（重い指摘が最も少ないもの）のまま。`warn` は `"advise"` と同じ扱い。
- 保存の必須条件には入れない。

`Observation.kind` に `"lint"`、`ReviewFinding.source` に `"lint"` を足す（既存の `"static"` は「描画が変わらない」の意味なので使わない）。制作担当のプロンプトでは、ホスト観測の節の中に `- lint: …` の行として並べる。

**型定義を制作担当に見せるか。** この節では見せない。節 2 の集計で `lint` の段階が減ったあとに、契約の文の代わり（または追加）に型定義を渡す版を、別の候補版として比べる。

### 4.4 試験（`tests/unit/lint.test.ts`）

- 表の規則ごとに、当たる作品と当たらない作品を 1 つずつ。行と列が作品の位置であること。
- `ev.code === "Space" || ev.key === " "` と書いた作品で指摘が無いこと。
- `type` を見ずに `ev.x` と `ev.code` の両方を読む作品で指摘が無いこと。
- `libraries` を宣言した作品で `THREE.` の使用に指摘が無いこと。
- `"advise"` では出し直しが起きないこと、`"enforce"` では `error` があり試行が残るときに出し直すこと（`tests/unit/review-loop.test.ts` と同じ偽の担当で）。
- `harness` が無い設定で、`tests/unit/service.test.ts` がそのまま通ること。

### 4.5 完了の確認

```sh
bun run typecheck
bun test tests/unit/lint.test.ts tests/unit/service.test.ts tests/unit/review-loop.test.ts
bun eval/harness/self-test.ts
bun run verify
```

自己確認で、正しい作品での指摘が 0 件であること。

## 5. 標準形を契約の既定にする

### 5.1 目的

「入力のたびに `frame(t, 0)` が呼ばれる」ことから来る誤り（跳べない、連打で速くなる）と、初期化・やり直しの漏れを、書き方の形で起きにくくする。`update(t, dt)` と `draw(t)` の形は `src/preview/bootstrap.js` に実装済みで、`update` は `dt > 0` のときだけ呼ばれる。今は物理・3D・シェーダーにだけ勧めている。

ホストの動作は変えない。契約の版（`canvas-artwork/1`）と digest も変えない。

### 5.2 触るファイル

| 種類 | ファイル | すること |
| --- | --- | --- |
| 変える | `docs/artwork-contract-v1.md` | 「実行」の最初の例を標準形にする |
| 変える | `docs/maker-skill.md` | 必須原則 1 と標準の流れ 4 の本文 |
| 変える | `docs/maker-pitfalls.md` | 確認済みの導出の誤りを 4 行足す |
| 変える | `tests/unit/maker-skill.test.ts` | 照合する文を足す |

### 5.3 仕様

**契約の最初の例。**

```js
canvasApp.start((api) => {
  let s;                                  // 状態は 1 か所に集める
  function reset() { s = { /* 初期の位置・得点・入力の状態 */ }; }
  reset();
  return {
    update(t, dt) { const sec = dt / 1000; /* 秒への換算はここだけ。移動・物理・出現・タイマー */ },
    draw(t) { /* 毎回、api.width・api.height から配置を計算して全体を描く */ },
    input(ev) { /* 入力は状態を書き換えるだけ。やり直しは reset() */ },
    resize(w, h, dpr) {},
  };
});
```

- 今の `frame(t, dt)` の例と説明は、「`frame` 1 つで書く形」として後ろに残す。**試験が照合している文は消さない**（`tests/unit/maker-skill.test.ts` の契約の照合：`**`dt = 0`** でも呼ばれる`、`` `dt <= 0` のときは ``、`if (dt > 0) update` ほか）。
- 制作手順の必須原則 1 は、見出し（`` `dt <= 0` では物理を進めない ``）を残し、本文を「既定は `update`・`draw` の形にする。`frame` で書くときは…」の順に入れ替える。標準の流れ 4 も同じ順にする。

**落とし穴に足す行（共通の表）。** いずれも [Luna low の不合格原因](../luna-low-quality-review.md) で原因まで確かめたもの。

| 症状 | 原因 | 直し方 |
| --- | --- | --- |
| 跳んだあと上へ加速して画面の外へ出る | 画面は下が正なのに、重力を引いている | 上向きの初速は負、重力は毎回足す |
| 跳ぶ高さが指定より低い | 初速を高さから求めていない | 高さ h に届く初速は √(2 × 重力 × h) |
| 動きが極端に遅い | 秒への換算を 2 回している | `dt / 1000` は 1 か所だけ |
| 端に当たるとすり抜ける | 当たりの幅が描画の幅より狭い | 当たりの半幅は、描画の半幅＋相手の半径 |

課題の名前・評価の語（`heldout` など）は書かない（既存の試験が照合している）。

### 5.4 試験と完了の確認

`tests/unit/maker-skill.test.ts` に足す：契約に `function reset()` と `update(t, dt)` が含まれること、落とし穴に `√(2` が含まれること。既存の期待値は変えない。

```sh
bun test tests/unit/maker-skill.test.ts tests/unit/prompt-maker.test.ts
bun run verify
```

制作手順は評価の直接生成（`eval/p3/cond-d.ts`）も読む。この節のあとの計測は、新しい候補版として記録する。

## 6. 差し替え：`Math.random` と時計

### 6.1 目的

`Math.random`・`Date.now`・`setTimeout` を禁じている理由は、観測の再現性だけである。ページ直接モードの実行時コード（`src/preview/page-runtime.js`）は、これらを seed つきの乱数と仮想の時計に差し替えている。Worker の作品にも同じ差し替えを入れ、禁止の規則を減らす。

### 6.2 触るファイル

| 種類 | ファイル | すること |
| --- | --- | --- |
| 変える | `src/preview/bootstrap.js` | 差し替え |
| 変える | `src/preview/shell.js` | Worker の `init` に `clock` と `virtual` を足す |
| 変える | `src/server/preview.ts`・`src/server/app.ts`・`src/server/main.ts` | 設定を配信へ渡す |
| 変える | `src/host/app.js` | 実時間の表示で seed を起動ごとに変える |
| 変える | `tests/unit/bootstrap.test.ts` | 試験を足す |
| 新規 | `tests/e2e/virtual-globals.spec.ts` | 実ブラウザでの確認 |

### 6.3 仕様

設定 `harness.virtualGlobals` が真のときだけ行う。

1. **乱数。** `Math.random` を seed つきの乱数にする。`api.random()` とは別の列にする（seed に定数を足して作る）。`api.random()` の列は変えない。
2. **時計（観測のときだけ）。** `init` の `clock` が `"manual"` のとき、`Date.now`・`performance.now`・`setTimeout`・`setInterval`・`clearTimeout`・`clearInterval` を仮想の時計に差し替える。`frame(dt)` で時間を進めたあと、期限の来たタイマーを `update` の前に呼ぶ。実時間の表示（`"raf"`）では差し替えない。作り方は `page-runtime.js` の `manualClock` と同じ。
3. **実行上限の時計。** `execution-budget.js` は読み込み時に本物の `performance.now` を確保しているので、差し替えの影響を受けない。この順序を変えない。
4. **seed。** 実時間の表示では、起動ごとに乱数の seed を作って渡す。観測・評価の seed は変えない。

（4）は 2026-11-11 に直した。`src/host/app.js` は起動のたびに `seed: 1` を渡していて、`api.random()` を使うゲームは利用者が開くたびに同じ展開になっていた。今は、実時間の表示（`clock` が `raf`）では起動ごとに seed を作り、`?clock=manual`（E2E と観測）では 1 のまま。実ブラウザでは確かめていない。

### 6.4 試験

- 偽の Worker 環境（`tests/unit/bootstrap.test.ts`）：同じ seed で `Math.random()` の列が同じ、違う seed で違う。`api.random()` の列が差し替えの前後で同じ。`clock: "manual"` で `setTimeout(f, 100)` が `advance(96)` では呼ばれず `advance(112)` で呼ばれる。
- 実ブラウザ：`Math.random` で色を決める作品を 2 回観測して画面が一致する。無限ループの停止の試験（`p0-threats.spec.ts`）がそのまま通る。
- 設定が偽のとき、Worker のスクリプトと動作が今と同じ。

### 6.5 決めてもらうこと

差し替えを有効にすると、保存済みの作品のうち `Math.random` を使うものの出方が変わる（seed で決まるようになる）。digest は変わらない。契約の文に「`Math.random` は seed つき」と足すだけにするか、契約の版を上げるかは、利用者が決める。決まるまで既定は無効。

## 7. 変更・修復を差分で返す

### 7.1 目的

基準の作品がある依頼でも、今は作品の全文を書き直させている。評価の基準作品は約 3KB までで、記録上の出力は最大 2,139 トークン。デモの作品は 8〜35KB、契約の上限は 128KiB ある。35KB の全文はおよそ 1 万トークンで（推定）、評価に使った出力の上限 8,192 を超える。

差分で返させると、「依頼された箇所だけを変える」を指示ではなく形で守れる。

### 7.2 触るファイル

| 種類 | ファイル | すること |
| --- | --- | --- |
| 新規 | `src/core/edits.ts` | 正規化と適用 |
| 変える | `src/core/prompt-maker.ts` | 出力の形、応答の検査、前置きの文 |
| 変える | `src/server/http-channel.ts` | `fenced` での置換の書き方 |
| 新規 | `tests/unit/edits.test.ts` | 単体試験 |
| 変える | `tests/unit/prompt-maker.test.ts`・`tests/unit/http-channel.test.ts` | 試験を足す |

`eval/p3/cond-d.ts` は変えない（記録と対応している）。

### 7.3 仕様

設定 `harness.edits` が真で、基準の作品があるときだけ使える。

**出力。** `entry` の代わりに `edits` を返せる。どちらか一方だけ。

```ts
interface Edit { find: string; replace: string } // find は 1〜8000 文字、replace は 0〜16000 文字。40 組まで
```

**適用（`applyEdits(base: string, edits: Edit[])`）。**

- 改行は `\n` にそろえる。
- 上から順に適用する。各 `find` は、**その時点の本文にちょうど 1 回**現れなければならない。
- 0 回のとき：`置換 N の find が基準の作品に見つからない`。`find` の 1 行目に、前後の空白を除いて一致する行が基準にあれば、`（似た行: 作品の L 行）` を足す。
- 2 回以上のとき：`置換 N の find が K か所に一致する。前後の行を足して 1 か所に絞る`。
- 失敗が 1 つでもあれば、全体を不合格にして全部の失敗を返す。途中まで適用した本文は使わない。

**適用する相手。** 出し直しのときも、常に基準の作品（保存版）に対して全部の置換を返させる。前の候補に重ねない。

**応答の検査。** 適用の失敗は、`validateMakerOutput` の不備として返す。形の出し直しの経路で、失敗の文が制作担当に戻る。適用できたら、できた本文を `body.entry` に入れて先へ進む。以後の経路（契約の検査、静的検査、観測、保存）は全文で返したときと同じ。

**`fenced` での書き方。** `<<<ENTRY … ENTRY` の代わりに次を返せる。

```
<<<EDITS
<<<FIND
（基準の作品にある文をそのまま）
<<<REPLACE
（置き換える文）
<<<END
EDITS
```

`<<<FIND` から `<<<END` までを組の数だけ繰り返す。目印は行の全体が一致したときだけ目印として読む。

**制作担当への文（前置きに足す）。** 「基準の作品があるときは、entry の代わりに edits を返せます。find は基準の作品の文を、空白も含めてそのまま写します。1 か所に決まるだけの長さにします。変更が作品の大半に及ぶときは entry を返します。」

### 7.4 試験（`tests/unit/edits.test.ts`）

| 試験 | 期待 |
| --- | --- |
| 1 組の置換 | 本文の該当箇所だけが変わる |
| 2 組で、2 組目の find が 1 組目の replace の中にある | 順に適用される |
| find が無い | 失敗。似た行があれば行番号つき |
| find が 2 か所に一致 | 失敗。一致の数つき |
| `\r\n` の基準作品 | 適用できる |
| entry と edits の両方・どちらも無い | 応答の検査で不備 |
| 基準の作品が無い依頼で edits | 不備 |
| 設定が偽 | 出力の形に edits が無い |

### 7.5 完了の確認

```sh
bun run typecheck
bun test tests/unit/edits.test.ts tests/unit/prompt-maker.test.ts tests/unit/http-channel.test.ts
bun run verify
```

調整用の課題の「大きい基準作品の変更」と「維持つきの変更」で、全文と差分を比べる。見るのは、段階 `form`・`grade` の数、出力のトークン数、提示までの時間。

## 8. 期待値を機械で照合する（`review.mode: "expect"`）

### 8.1 目的

制作担当が、依頼の中で数値で確かめられる点を期待として書き、ホストが測って突き合わせる。判定に LLM を使わない。

跳ぶ高さ（期待 約 80px、実装 約 20px）、維持する速さ（期待 0.300、実装 0.600 px/ms）、落下の速さ（期待 150、実装 0.15 px/s）は、どれも数値を測れば分かる不合格だった。画像による修正では、判定役が指定の色を誤りと判断して合格の候補を壊した。機械の照合は、この種類の誤判定をしない。

依頼の読み違いは見つけられない（期待と実装が同じ読みで揃うため）。これは限界として結果の文書に書く。

### 8.2 触るファイル

| 種類 | ファイル | すること |
| --- | --- | --- |
| 変える | `src/core/eval-types.ts` | `track`・`shot` に期待を足す、正規化 |
| 変える | `src/core/script-runner.ts` | 測定と期待を比べる |
| 変える | `src/core/host-reviewer.ts` | `expect` の経路 |
| 変える | `src/core/review.ts`・`src/core/service.ts` | モード `"expect"` |
| 変える | `src/core/prompt-maker.ts` | 期待の書き方の文 |
| 新規 | `eval/harness/expectations/*.json` | 対照用に手で書いた期待（4 本） |
| 変える | `tests/unit/eval-types.test.ts`・`script-runner.test.ts`・`review-loop.test.ts` | 試験を足す |

### 8.3 仕様

**期待の形。** 既存の手順 `track`（指定の色のまとまりの位置と大きさを測る）と `shot` に、任意の項目 `expect` を足す。座標は観測の面（480×360、CSS ピクセル）。

```ts
type Range = [number, number];             // [下限, 上限]。下限 ≦ 上限
interface TrackExpect {
  present?: boolean;                        // その色の画素があるか
  x?: Range; y?: Range; w?: Range; h?: Range; // 中心の位置、外接する幅と高さ
  from?: string;                            // 同じ台本の、前にある track の label
  dx?: Range; dy?: Range;                   // from の測定からの中心の移動。from が無ければ、同じ色の直前の track
}
interface ShotExpect { changed: boolean }   // 直前の shot から画面が変わったか
```

- 正規化で、形の合わない項目は捨てる。全部の項目が捨てられた `expect` は無いものとして扱う。
- 幅が 2 未満の範囲は、両側に 1 を足して比べる（縁のにじみのため）。ホストがそれ以上に範囲を広げることはしない。

**比べ方（`runScript`）。** 測定に `check?: { pass: boolean; text: string }` を付ける。文の例：`期待 dy −90〜−70／実測 dy −20`。`from` の測定が無い、色の画素が無いのに位置の期待がある、のときは `pass: false` で理由を書く。

**経路。** 既存の `replay` の経路（制作担当が最初の応答で台本を提案し、ホストが同じ seed で実行し、直したあとに同じ台本を再生する）を使い、検証担当の呼び出しだけを無くす。

- `service.ts`：`review.mode === "replay"` で分岐している箇所を、`"replay"` または `"expect"` で通るようにする。
- `host-reviewer.ts` の `replay`：モードが `"expect"` のときは `judge` を呼ばない。`check.pass === false` の測定 1 つにつき、指摘を 1 つ作る。出所は `"expect"`、重さは `blocking`、id は測定の id、文は `[台本の purpose] <label>：<check.text>`。
- 直しは 1 回まで（今の `replay` と同じ）。直した候補は、同じ台本で食い違いが 0 件になり、必須の検査に通ったときだけ提示する。そうでなければ元の候補を提示する（今の `repairPlan` の分岐のまま）。
- 残った食い違いは、候補の `review` に残して画面に出す。保存は止めない。
- 検証担当（`evaluator`）の設定が無くても動く。

**制作担当への文。** 指摘は「誤り」と書かず「食い違い」と書く。期待の側が誤っていることがあるため。「期待と実測が食い違っています。依頼に照らして、作品か期待のどちらが違うかを判断し、作品が違うときだけ直します。」

**期待の書き方の文（前置きに足す）。** 「依頼に数値（寸法・速さ・時間・個数）があるときは、その数値を測る手順を replay に書けます。色を決めた要素を track で 2 回測り、移動の量を dx・dy の範囲で書きます。範囲には、指定の値の前後 1 割を取ります。数値が無い依頼では書かなくて構いません。」

制作担当が出す台本は、今の `replay` と同じく 1 本（出力の項目 `replay`）。その中の測定は既存の `PLAN_LIMITS` のまま 12 個まで。台本を複数にするかは、この節の結果を見てから決める。

### 8.4 試験

- 正規化：範囲の上下が逆・数でない・`from` が後ろの label、を捨てる。
- 比べ方：範囲の内・外・境界、幅 0 の範囲、`from` つきの移動、画素が無い場合。
- ループ：偽の担当で、食い違いあり → 直して 0 件 → 直した候補を提示。食い違いあり → 直しても残る → 元の候補を提示。検証担当の呼び出しが 0 回であること。
- 自己確認：手で期待を書いた 4 本は食い違い 0 件。その変異（`sign-flip`・`double-convert`・`half-speed`）は食い違いあり。

### 8.5 完了の確認

```sh
bun run typecheck
bun test tests/unit/eval-types.test.ts tests/unit/script-runner.test.ts tests/unit/review-loop.test.ts tests/unit/replay.test.ts
bun eval/harness/self-test.ts
bun run verify
```

調整用の課題の「数値の導出」で、`review: off` と `"expect"` を比べる。見るのは、段階 `grade` から `pass` へ移った数、直して悪くなった数（元が合格で、提示が不合格になった試行。0 件であること）、提示までの時間。

## 9. 保存の接続面

### 9.1 目的と範囲

作品が、利用者のデータを保存して読み戻せるようにする。作品は通信しない。宣言したコレクションと操作だけを、ホストが仲介する。

Eumenes には、Web アプリ開発の担当（`app-development`）が同じ考え方の仕組みを持っている：アプリが保存するコレクションと操作を宣言し、ホストがアプリごとの SQLite にテーブルを作る。アプリから SQL やファイルには触れない（`../eumenes/api/domains/app-development/storage-contract.ts`）。この節の宣言と要求の形は、それに合わせる。

宣言は、ホストが解釈して実行するプログラムであり、バックエンドの実装である。誰が書くかは設定で切り替える（9.3）。

**対象外。** 定期実行・複数手順・外部への副作用を持つ処理（Eumenes の workflow）。数秒の画素の観測では確かめられず、検証の仕組みが別になる。

### 9.2 触るファイル

| 種類 | ファイル | すること |
| --- | --- | --- |
| 新規 | `src/contract/storage.ts` | 宣言の型と検査、要求の検査、変更の規則 |
| 変える | `src/contract/artwork.ts` | 作品の任意項目 `storage`、digest |
| 変える | `src/contract/artwork-api.ts` | 宣言から保存の型を作る |
| 新規 | `src/core/records.ts` | 保存の接続口と、メモリ上の実装 |
| 変える | `src/shared/messages.js` | メッセージの型と上限 |
| 変える | `src/preview/bootstrap.js`・`src/preview/shell.js` | `api.records` と中継 |
| 変える | `src/host/preview-client.js`・`src/host/app.js`・`src/host/harness.js` | 要求の受け口 |
| 変える | `src/server/canvas-app.ts`・`src/core/service.ts` | `POST /api/records`、権限の照合 |
| 変える | `src/core/prompt-maker.ts`・`src/core/model-port.ts` | 宣言の受け渡し |
| 変える | `docs/artwork-contract-v1.md` | 保存の節 |
| 新規 | `tests/unit/storage.test.ts`・`tests/unit/records.test.ts`・`tests/e2e/records.spec.ts`・`tests/e2e/records-threats.spec.ts` | 試験 |

### 9.3 誰が宣言を書くか

| 設定 `harness.storage` | 動作 |
| --- | --- |
| `"off"`（既定） | `storage` は契約の未定義の項目として拒否する（今と同じ） |
| `"maker"` | 制作担当が、`spec` のあと `entry` の前に `storage` を書く |
| `"given"` | 依頼に付いてきた宣言を使う。制作担当の出力の形に `storage` は無い |

どちらでも、宣言は作品に付くデータで、ホストの検査・型の生成・仲介・観測は同じ。切り替えで作り直しは出ない。既定にする側は、調整用の課題の「保存あり」で、段階 `contract`・`lint` の数と、保存を使わない課題の成績が下がらないことを見て決める。

### 9.4 宣言

```ts
interface StorageDecl {
  version: 1;
  collections: {
    id: string;                                   // /^[a-z][a-z0-9_]{0,31}$/
    fields: { name: string; type: "string" | "integer" | "number" | "boolean"; required: boolean }[]; // name は /^[a-zA-Z][a-zA-Z0-9_]{0,40}$/
    operations: ("list" | "get" | "create" | "update" | "delete")[]; // 1 個以上、重複なし
  }[];                                            // 1〜8 個
}
```

- コレクションと項目名の形、コレクションの数（8）、操作の 5 種は、Eumenes の契約と同じ（確認済み）。項目の数は 24 まで（Eumenes の上限。調査の報告で、実装のときに現物で確かめる）。
- Eumenes の宣言は、項目を名前つきの JSON Schema に分けて持つ。この冊の形（項目の並び）は、取込のときに adapter が機械的に変換する。
- digest は、`storage` があるときだけ宣言を入れて計算する（`libraries` と同じ扱い。無い作品の digest は変わらない）。

**変更の規則。** 基準の作品に宣言があるとき、候補の宣言で許すのは「コレクションの追加」と「必須でない項目の追加」だけ。削除、名前や型の変更、必須の項目の追加は、契約の検査で不合格にする。文：`保存の宣言の変更は、コレクションの追加と、必須でない項目の追加だけ`。Eumenes の自動の移行と同じ範囲（調査の報告）。

### 9.5 作品から見た API

```js
const tasks = api.records("tasks");
const page = await tasks.list({ page: 0, sort: "title", search: { field: "title", value: "買い物" } });
const one = await tasks.get(id);
const made = await tasks.create({ title: "牛乳", done: false });
const next = await tasks.update(made.id, made.revision, { done: true });
await tasks.delete(next.id, next.revision);
```

- 戻り値は Promise。記録は `{ id, revision, values }`、`list` は `{ records, page, hasMore }`。1 ページ 25 件。`id` と `revision` はホストが決める。
- `update` と `delete` は、手元の `revision` を渡す。違っていれば失敗する（競合）。
- 失敗は Promise の失敗で、文に理由が入る（宣言に無いコレクション・操作、項目の型の違い、必須の項目が無い、競合、上限）。
- 結果が届くと、ホストは入力と同じく `frame(t, 0)`（標準形では `draw`）を呼ぶ。setup の中で頼んだ `list` は、済むまで（最長 3 秒）起動の完了を待つ。`api.decodeSVG` と同じ扱い。
- 要求の形は Eumenes の `recordRequest` と同じ（確認済み）。記録の応答の形は、取込のときに突き合わせる（未確認）。

### 9.6 仲介の経路

作品（Worker）→ シェル → ホストの画面 → ホストのサーバー。`api.decodeSVG` の経路をホストまで延ばす。プレビューオリジンには資格情報を置かない。

| 向き | メッセージ | 検査 |
| --- | --- | --- |
| 作品 → シェル | `{ type: "records", id, collection, request }` | `checkWorkerToShell`。`request` は 4 KiB まで |
| シェル → ホスト | `{ type: "records", runId, id, collection, request }` | `checkShellToHost` |
| ホスト → シェル | `{ type: "records-result", runId, id, ok, value }` | `checkHostToShell`。64 KiB まで |
| シェル → 作品 | `{ type: "records-result", id, ok, value }` | — |

上限（`LIMITS` に足す）：毎秒 20 件、同時 8 件。超えた要求は失敗として返す（作品は止めない）。

**ホストの画面。** `PreviewController` に `onRecords(collection, request)` を足す。

- 制作画面（`app.js`）：`POST /api/records` を呼ぶ。本文は、プレビューの出所（候補の id、または作品の id と版）、コレクション、要求。
- 観測のハーネス（`harness.js`）：ページの中のメモリ上の保存を使う。**観測・検証・評価は、サーバーの保存に届かない。**

**サーバー（`POST /api/records`）。** ほかの変更系 API と同じく `Origin` を照合する。

1. 出所を `resolvePreview` と同じ規則で解決し、所有者を照合する。
2. その作品の宣言に、コレクションと操作があることを確かめる。
3. 値を宣言の項目と照らす（型、必須、宣言に無い項目は拒否、1 件 4 KiB まで）。
4. 保存先を選ぶ。保存版から開いた作品は、作品ごとの保存。**候補のプレビューは、候補ごとの一時の保存**（メモリ上、実行が終われば消える）。試作中の候補が利用者のデータを書き換えない。

**検証ホストの保存。** `RecordStore` の接続口と、メモリ上の実装 `MemoryRecordStore` を作る。検証ホストは、作品ごとに `<dataDir>/records/<作品の id>.json` に書き出す。これは検証ホストだけの代行で、本体では Eumenes の保存に差し替える（今、版の保存を `Store` が代行しているのと同じ位置づけ）。

### 9.7 静的検査との接続

- `artworkApiTypes` は、宣言から `api.records` の型を作る。宣言したコレクションの id だけを受け、項目の型が値に付く。
- `api.records("<文字列の直書き>")` の id が宣言に無いときは、規則 `api-property` と同じ重さで指摘する。
- 宣言に無い操作の呼び出し（`operations` に `delete` が無いのに `.delete(`）も同じ。

### 9.8 試験

**単体。** 宣言の検査（形、数、重複）。変更の規則（許す 2 つ、拒否する 4 つ）。要求の検査。`MemoryRecordStore` の 5 操作、競合、ページ、検索、上限。digest が宣言で変わり、宣言の無い作品で変わらないこと。

**実ブラウザ（`records.spec.ts`）。** 作る → 一覧に出る → 更新 → 削除。開き直して残っている。候補のプレビューで作った記録が、保存版の一覧に出ない。観測の間、`server.log` に `/api/records` の要求が無い。

**脅威（`records-threats.spec.ts`）。** 侵害 0 件であること。

- 宣言に無いコレクション・操作の要求が拒否される。
- 作品が `self.postMessage` で偽の `records-result` を送っても、何も起きない。
- 作品が別の作品の id を要求に入れても届かない（出所はホストの画面が決め、作品は指定できない）。
- 頻度・同時数・大きさの上限を超えた要求が失敗として返り、ホストの画面が操作できる。
- 別の所有者（`singleUser: false`）の作品の保存に届かない。
- 設定が `"off"` のとき、`storage` を持つ作品が契約の検査で拒否され、`api.records` が無い。

### 9.9 完了の確認

```sh
bun run typecheck
bun test tests/unit/storage.test.ts tests/unit/records.test.ts tests/unit/messages.test.ts tests/unit/contract.test.ts
bunx playwright test tests/e2e/records.spec.ts tests/e2e/records-threats.spec.ts
bun run verify
```

## 10. 観測の操作を一本化する（host-smoke/4）

ハーネスを操作する実装が、`src/core/observer.ts`、`src/core/harness-session.ts`、`eval/lib/env.ts` にある。可視化の課題が 3 試行とも保存できなかったのは、製品の観測と採点器で押すキーが違ったためだった（[画像修正の比較](../vision-repair-evaluation.md)）。host-smoke/3 でキーの変換の共有が始まっている。

- `PlaywrightObserver.observe` を `HarnessSession` の上に載せる。撮る時点、進める時間、クリックの点、文は変えない。
- 宣言されたキーがあるときも、そのあとに既定のキー（← → ↑ Space）を押す。宣言が不完全なときの偽陰性を減らす。宣言と重なるキーは 1 回だけ。
- 観測の入力が変わるので、版を `host-smoke/4` にする。
- `eval/lib/env.ts` は変えない（凍結した採点が使う）。

確かめ方：`tests/unit/observer.test.ts` の全部が通ること。宣言が 1 つだけで、それが条件つきの操作（先に別のキーが要る）の作品でも、既定のキーで描画が変われば `responds` が合格すること。正しい作品の一覧（2.3）で、必須の検査の結果が host-smoke/3 と同じか、合格が増えるだけであること。

## 11. 間違えやすい点

- **既定を変えない。** 各節は設定で有効にしたときだけ動く。`harness` の無い設定で、既存の試験が 1 つも変わらずに通ること。変える期待値は、各節に書いたものだけ。
- **規則を足して誤検出を消さない。** 正しい作品で指摘が出たら、その規則を外すか狭める。例外の条件を積まない。
- **静的検査を保存の条件にしない。** 重い指摘が残っても、必須の検査に通った候補は保存できる。
- **題材で分けない。** 静的検査の規則、期待の比べ方、保存の検査は、どの作品にも同じものを当てる（規則 3）。
- **観測の固定点を外に出さない。** 期待の座標は制作担当が自分の作品について書くもので、ホストの固定点とは関係しない。固定点の座標・個数を文に書かない（規則 4）。
- **評価の資材を写さない。** 落とし穴に足す行は、原因と直し方だけを書く。課題の文・判定・作品の名前を写さない（規則 5）。
- **期待の食い違いを「誤り」と呼ばない。** 期待の側が違うことがある。
- **差分は基準の作品に対して。** 前の候補に重ねると、適用の結果が試行ごとに変わる。
- **候補の保存先を分ける。** 候補のプレビューから、利用者の保存に書かせない。
- **メッセージを足すときは、型と上限を必ず足す。** `checkWorkerToShell`・`checkShellToHost`・`checkHostToShell` に無い型は、今と同じく捨てられること（規則 7）。
- **サーバーを勝手に起動しない**（規則 9）。

## 12. この設計の裏取り

**読んで確かめたこと（コード・記録）。**

- 記録済みの推論を引く鍵（`src/core/recorded-provider.ts` の `keyOf`）は、依頼・会話・基準の digest・試行・前の候補の digest だけ。契約や制作手順の文を変えても、固定応答は引ける。
- `tests/unit/maker-skill.test.ts` は、制作手順と契約の文面を照合している。節 5 は照合している文を残す。
- 実測の接続の設定には `format` が無い。記録した 126 応答の `finish_reason` はすべて `stop`、出力は最大 2,139 トークン、low の推論は 1 応答あたり 240〜290 トークンほど。
- `src/host/app.js` は起動のたびに `seed: 1` を渡していた（6.3 のとおり直した）。
- 実行上限の誤作動は、偽の Worker 環境で再現した（2.6 のとおり直した）。
- 既存の `replay` の経路は、台本の実行のあとに検証担当の判定を呼ぶ（`src/core/host-reviewer.ts` の `replay`）。直した候補は、重い指摘が 0 件のときだけ提示される（`src/core/service.ts`）。
- Eumenes の保存の契約：コレクションと項目名の形、コレクションは 8 個まで、操作は 5 種、`update` と `delete` は `expectedRevision` が必須（`../eumenes/api/domains/app-development/storage-contract.ts`）。
- 型検査と、サーバーを起動しない単体試験 22 ファイル 159 件が通る（2026-11-11）。

**推定（確かめていない）。**

- 実行上限の修正と seed の修正が、実ブラウザ（Worker とページ直接モード）でも期待どおりに動くこと（2.6・6.3）。
- 35KB の作品の全文がおよそ 1 万トークン（7.1）。
- TypeScript の検査が、正しい作品で誤検出 0 件にできること。規則の表は、自己確認の結果で減ることがある。
- 静的検査 1 回の時間。標準ライブラリを保持すれば 1 秒以内と見込む。

**調査の報告で、自分では確かめていないこと。**

- Eumenes の保存の、項目の数の上限（24）、1 ページ 25 件、自動の移行の範囲、記録の応答の形。
- `eumenes_collaboration` は対話の判断部分で、コードの実行や DB を持たない。

## 13. 取込（P4）で先に要ること

この冊の対象外だが、調べて分かったので残す。

- Eumenes の SPA の CSP は `default-src 'self'` で、`frame-src` の指定が無い（`../eumenes/vite.config.ts`）。design.md §4 が前提にする別サイトのプレビューオリジンの iframe は、今のままでは置けない。`frame-src` にプレビューオリジンを足す変更と、そのオリジンの待ち受けが要る。
- Eumenes は、大きな設計の変更に事前の設計書と合意を求めている（`../eumenes/AGENTS.md`）。

## 14. 利用者に決めてもらうこと

1. **`Math.random` の差し替え**（6.5）。契約の文に足すだけにするか、契約の版を上げるか。
2. **保存の持ち主**（節 9）。Canvas の作品を Eumenes の `app-development` のアプリの画面として載せるか、Canvas のドメインが保存の台帳を別に持つか。この冊の接続面はどちらでも同じなので、節 9 の実装は先に進められる。
3. **宣言の書き手の既定**（9.3）。調整用の課題の結果を見て決める。
4. **調整用の課題と、判定用の未使用課題**（2.7）。課題の文の凍結は評価担当が行う。
