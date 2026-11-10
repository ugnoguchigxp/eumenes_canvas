# 01 エラーに作品の行と該当行を付ける

## 1. 目的

いま制作担当に返るエラーは `frame: bal is not defined` のような文だけで、作品のどこで起きたかが分からない。構文エラーも `構文エラー: Unexpected token ')'` だけである。自己修復の成否は返す情報の質で決まるので、**作品の何行目か**と**その行の本文**を付ける。

変更後に制作担当へ返る文の例:

```
frame: bal is not defined（作品の 42 行 13 列）［該当行: ctx.fillRect(bal.x, bal.y, 8, 8);］
構文エラー: Unexpected token ')' ／ Unexpected )（作品の 3 行 37 列）［該当行: return { frame(t, dt) { if (x > ) {} } };］
```

## 2. 触るファイル

| 種類 | ファイル | すること |
| --- | --- | --- |
| 変える | `src/preview/bootstrap.js` | 行のずれを持つ変数、位置を取り出す関数、エラーの文に位置を足す |
| 変える | `src/server/preview.ts` | `assembleWorkerScript` が作品の直前で行のずれを設定する |
| 新規 | `src/core/locate.ts` | 該当行を足す関数、構文エラーの位置を調べる関数 |
| 変える | `src/core/service.ts` | 制作担当に返す観測の文に、上の 2 つを使う |
| 新規 | `tests/unit/locate.test.ts`・`tests/unit/bootstrap.test.ts`・`tests/unit/assemble.test.ts` | 単体試験 |
| 新規 | `tests/e2e/error-location.spec.ts` | 実ブラウザでの確認 |

触らない: `src/core/observer.ts`（観測の文の組み立てはそのまま。位置はブートストラップが文に入れる）、`src/shared/messages.js`。

## 3. 仕様

### 3.1 行のずれ

作品 Worker のスクリプトは「ブートストラップ → 同梱ライブラリ → `;(function (canvasApp, …) {` → `"use strict";` → 作品の本文 → `}).call(…)`」の順に連結されている（`src/server/preview.ts` の `assembleWorkerScript`）。ブラウザのスタックに出る行番号は、この連結したスクリプトの行番号である。

- **ずれ（offset）** = 作品の 1 行目より前にある行の数。作品の N 行目は、スクリプトの `offset + N` 行目になる。
- ずれは、作品の直前の行で、グローバル変数 `__canvasEntryLine` に入れる。数字の桁数は行数に影響しないので、先に `0` を入れて行を数え、数えた値で作り直せばよい。

### 3.2 ブートストラップ（`src/preview/bootstrap.js`）

1. 先頭の `var __canvasLibs = {};` の次の行に、`var __canvasEntryLine = 0;` を足す（コメント：作品本体の 1 行目の直前までの行数。プレビューの配信が作品の直前で設定する）。
2. `reportError` の直前に、関数 `entryPos(err)` を足す。
   - 入力：例外オブジェクト。
   - `String((err && err.stack) || "")` に対して、正規表現 `/\/w\/[^\s:)]+:(\d+):(\d+)/` の**最初の一致**を取る。Chromium の `at Object.frame (http://127.0.0.1:4301/w/<token>:262:17)` と、WebKit の `frame@http://127.0.0.1:4301/w/<token>:262:17` の両方に一致する。
   - 一致が無ければ空文字を返す。
   - `line = Number(一致の 1 番目) - __canvasEntryLine`。`line >= 1` でなければ空文字を返す（ブートストラップやライブラリの中の行）。
   - 返す文は `"（作品の " + line + " 行 " + 列 + " 列）"`。全角の括弧。列はスタックの値をそのまま使う。
3. `reportError` の文の組み立てを変える。
   - 変更前：`post({ type: "error", message: msg.slice(0, 1000) });`
   - 変更後：`post({ type: "error", message: msg.slice(0, 940) + entryPos(err) });`
   - 940 で切るのは、位置の文を足しても全体が 1000 文字（`LIMITS.errorMessageChars`）を超えないようにするため。

トークンを文に入れないこと（正規表現で取り出すのは行と列の数字だけ）。

### 3.3 配信（`src/server/preview.ts` の `assembleWorkerScript`）

戻り値の組み立てを次の形にする。

- `head(n)` = ブートストラップ ＋ ライブラリの文 ＋ `"\n;__canvasEntryLine=" + n + ";(function (" + params + ") {\n\"use strict\";\n"`
- `offset` = `head(0).split("\n").length - 1`
- 戻り値 = `head(offset)` ＋ 作品の本文 ＋ `"\n}).call(undefined, " + args + ");\n"`

既存の試験（`tests/unit/render-libraries.test.ts`）は、出力に `;(function (canvasApp) {` と `;(function (canvasApp, THREE, CANNON) {` が含まれることを確かめている。上の形なら、`;__canvasEntryLine=123;(function (canvasApp) {` の中にその文字列がそのまま含まれるので、通る。**`(function` の直前の `;` を消さないこと。**

### 3.4 該当行と構文エラーの位置（新規 `src/core/locate.ts`）

2 つの関数を export する。どちらも純粋な関数（入力の文字列だけで決まる）。

**`withSourceLine(message: string, entry: string): string`**

- `message` の中の `（作品の N 行 M 列）` に一致する箇所**すべて**（正規表現 `/（作品の (\d+) 行 (\d+) 列）/g`）について、その直後に `［該当行: <作品の N 行目>］` を足す。
- 作品の N 行目は、`entry` の `\r\n` を `\n` に直して `\n` で分けた配列の `N - 1` 番目。前後の空白を除き、160 文字で切る。
- N 行目が無い、または空白だけなら、何も足さない。
- 一致が無ければ `message` をそのまま返す。

**`syntaxErrorDetail(entry: string): string | null`**

- `globalThis.Bun?.Transpiler` が無ければ `null` を返す（Bun 以外の環境でも落ちないようにする）。
- `new Bun.Transpiler({ loader: "js" }).transformSync("(function () {\n\"use strict\";\n" + entry + "\n})")` を呼ぶ。例外が出なければ `null`。
- 例外が出たら、`e.errors?.[0] ?? e` を最初のエラーとする。その `position`（`{ line, column, lineText }`）が無い、または `line` が数値でなければ `null`。
- 作品の行 = `position.line - 2`（前に 2 行足しているため）。1 未満なら `null`。
- 返す文は `"<エラーの message>（作品の <行> 行 <column> 列）［該当行: <lineText の前後の空白を除いて 160 文字まで>］"`。

確かめた値（Bun 1.4.4）：`"canvasApp.start((api) => {\n  let x = 1;\n  return { frame(t, dt) { if (x > ) {} } };\n});"` に対して、`position.line` は 5（作品の 3 行目）、`lineText` はその行の全文。

### 3.5 サービス（`src/core/service.ts` の `execute`）

制作担当に次の試行で渡す `observations` を作る 2 か所だけを変える。**検証記録（`Verification.checks`）の `detail` は変えない。**

1. 契約の検査に落ちたとき。変更前は `observations = contract.errors.map((m) => ({ kind: "contract" as const, message: m }));`。
   - `contract.errors` の中に `"構文エラー"` で始まる文があるときだけ、`syntaxErrorDetail(作品の本文)` を 1 回呼ぶ。
   - 結果が `null` でなければ、`"構文エラー"` で始まる文の後ろに `" ／ " + 結果` を足す。ほかの文はそのまま。
   - 作品の本文は `out.body.entry`。契約の検査に落ちた作品では文字列でないことがあるので、`String(… ?? "")` で文字列にしてから渡す。
2. ホスト観測の結果を受け取ったとき。変更前は `observations = obs.observations;`。
   - `kind` が `"runtime-error"` の観測だけ、`message` を `withSourceLine(message, out.body.entry)` に置き換える。ほかの観測はそのまま。

## 4. 手順

1. `src/preview/bootstrap.js` を 3.2 のとおりに変える。
2. `src/server/preview.ts` を 3.3 のとおりに変える。
3. `src/core/locate.ts` を 3.4 のとおりに作る。
4. `src/core/service.ts` を 3.5 のとおりに変える（`import { syntaxErrorDetail, withSourceLine } from "./locate";` を足す）。
5. 試験を足す（次の節）。

## 5. 試験

### 5.1 `tests/unit/locate.test.ts`

作品の本文を次の 5 行とする：`canvasApp.start((api) => ({` ／ `  frame() {` ／ `    api.ctx.fillRect(bal.x, 0, 1, 1);` ／ `  },` ／ `}));`

| 試験 | 入力 | 期待 |
| --- | --- | --- |
| 該当行を足す | `"frame: bal is not defined（作品の 3 行 22 列）"` | `"frame: bal is not defined（作品の 3 行 22 列）［該当行: api.ctx.fillRect(bal.x, 0, 1, 1);］"` |
| 2 か所とも足す | `"[キー入力の段階で発生] input: x（作品の 2 行 1 列） / frame: y（作品の 3 行 5 列）"` | 2 か所それぞれの直後に `［該当行: frame() {］` と `［該当行: api.ctx.fillRect(bal.x, 0, 1, 1);］` |
| 位置が無い | `"frame: boom"` | そのまま |
| 行が無い | `"frame: boom（作品の 99 行 1 列）"` | そのまま |
| 正しい作品 | `syntaxErrorDetail(上の 5 行)` | `null` |
| 構文エラー | 3.4 の例の 4 行 | 結果が `"（作品の 3 行 "` と `"［該当行: return { frame(t, dt) { if (x > ) {} } };］"` を含む |
| 1 行目の構文エラー | `"const a = (;"` | 結果が `"（作品の 1 行 "` を含む |

### 5.2 `tests/unit/bootstrap.test.ts`（偽の Worker 環境）

ブートストラップを、ブラウザなしで動かす試験。この冊では土台と、エラーの位置の試験だけを書く。02 と 05 で同じファイルに試験を足す。

**土台（試験ファイルの中の補助関数 `boot(entry)`）:**

1. `src/preview/bootstrap.js` を文字列として読む。
2. 偽の面のクラスを用意する：`width`・`height`・`name` を持ち、`getContext()` は `setTransform`・`clearRect`・`drawImage`・`fillRect` を持つ物を返し、`transferToImageBitmap()` は `{ width, height }` を持つ物を返す。
3. 偽の `self` を用意する：`postMessage(m)` は配列 `posted` に積む。`addEventListener("message", f)` は `f` を覚える。`navigator` は空の物。
4. スクリプト全体を `assembleWorkerScript` と同じ形で作る（3.3 の `head`・`offset`）。
5. `new Function("self", "OffscreenCanvas", スクリプト)(偽の self, 偽の面のクラス)` で実行する。
6. 返す物：`posted`、`send(m)`（覚えた `f` に `{ data: m }` を渡す）、`offset`。

起動のメッセージは `{ type: "init", width: 480, height: 360, dpr: 1, data: null, seed: 1 }`。

**この冊で書く試験:**

| 試験 | すること | 期待 |
| --- | --- | --- |
| 従来の動作 | 作品 `canvasApp.start((api) => ({ frame(t, dt) { api.status({ t, dt }); } }))`。`init` → `tick`（t=100）→ `tick`（t=116）→ キーの `input` → `pointermove` の `input` → `advance`（ms=40） | `posted` の型は最初の 3 件が `status`・`frame`・`ready`。`status` の `[t, dt]` は順に `[0,0]`・`[0,0]`・`[16,16]`・`[16,0]`・`[32,16]`・`[48,16]`・`[56,8]`。最後は `{ type: "advanced", seq }` |
| エラーの位置 | 作品の 3 行目で、`stack` を `"Error: boom\n    at Object.frame (http://127.0.0.1:4301/w/tok_A-1:" + (__canvasEntryLine + 3) + ":15)"` に書き換えた例外を投げる | エラーの文が `"frame: boom（作品の 3 行 15 列）"` |
| ブートストラップの中の行 | `stack` の行番号を 10 にした例外 | エラーの文が `"frame: x"`（位置なし） |
| 長い文 | 2000 文字の文の例外（位置あり） | 文の長さが 1000 以下で、`"（作品の 1 行 2 列）"` で終わる |
| ずれの値 | 1 行の作品 | `offset` が「ブートストラップの行数 − 1 ＋ 3」 |

### 5.3 `tests/unit/assemble.test.ts`

- 作品 `"const FIRST_LINE = 1;\ncanvasApp.start((api) => ({ frame() {} }));"` を `assembleWorkerScript` に渡す。
- 出力から `/;__canvasEntryLine=(\d+);\(function \(canvasApp\) \{\n"use strict";\n/` で数字を取り出す。
- 出力を `\n` で分けた配列の、その数字の添字の要素が `"const FIRST_LINE = 1;"` であること。
- 出力に `;(function (canvasApp) {` が含まれること。

### 5.4 `tests/e2e/error-location.spec.ts`

既存の `tests/e2e/support/harness.ts` の `openHarness`・`start`・`advance`・`events` を使う。

- 作品（4 行目で落ちる）:

  ```js
  canvasApp.start((api) => ({
    frame(t, dt) {
      api.ctx.fillStyle = "#000"; api.ctx.fillRect(0, 0, api.width, api.height);
      if (t > 50) undefinedFunctionForTest();
    },
  }));
  ```

- 起動して `advance(100)` したあと、`events` の中の `type === "error"` の最初の文を取る。
- Chromium：文が `/^frame: .*undefinedFunctionForTest.*（作品の 4 行 \d+ 列）$/` に一致する。
- WebKit：文が `frame: ` で始まる。位置が付いているときは `（作品の 4 行 ` を含む（WebKit のスタックの形で位置が取れない場合は、位置なしでよい。取れなかったときは、その事実を結果の文書に書く）。

## 6. 完了の確認

```sh
bun run typecheck
bun test tests/unit/locate.test.ts tests/unit/bootstrap.test.ts tests/unit/assemble.test.ts
bun test tests/unit/service.test.ts tests/unit/render-libraries.test.ts tests/unit/maker-skill.test.ts
bunx playwright test tests/e2e/error-location.spec.ts
bun run verify
```

すべて通ること。既存の試験の期待値は、この冊では 1 つも変えない。

## 7. 間違えやすい点

- **行の数え方。** `split("\n").length - 1` は「改行の数」＝「作品の 1 行目より前の行の数」。1 を足したり引いたりしない。5.3 の試験が正しさを確かめる。
- **`"use strict";` の位置。** 作品の本文の直前の行に置く（今と同じ）。`"use strict";` と作品の本文を同じ行に繋げない。
- **`reportError` のほかの部分。** 5 件までという上限（`errorsSent >= 5`）はそのまま。
- **Worker の最上位で起きた例外**（`canvasApp.start` の外に書かれたコードの例外）は、シェルの `worker.onerror` が受けるので、この冊の対象外。位置は付かない。今と同じ文が返る。
- **検証記録の `detail` に該当行を入れない。** 該当行は作品のコードの一部なので、制作担当に返す `observations` にだけ入れる。
