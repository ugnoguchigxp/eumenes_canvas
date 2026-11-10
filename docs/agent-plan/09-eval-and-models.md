# 09 評価の実行器・自己確認・集計・実モデルの接続

## 1. 目的

01〜08 で作ったものが、実際に役に立つかを測れるようにする。

1. **性質の観測の自己確認**：推論を使わずに、既存の作品で偽陽性（正しい作品に「要修正」が付く）が無いことを確かめる。
2. **評価の実行器に条件 A を足す**：制作担当（宣言つき）＋検証（観測・検証担当）の構成で、既存の課題（general-v1・render-v1）を実行する。
3. **集計に 2 つの指標を足す**：「必須の検査に通ったが判定で落ちた件数」と「検証担当の判定の当たり外れ」。
4. **実モデルの接続**：OpenAI 互換の HTTP で呼べるモデルを、制作担当・検証担当として使えるようにする。

## 2. 触るファイル

| 種類 | ファイル | すること |
| --- | --- | --- |
| 新規 | `eval/agent/probe-self-test.ts` | 性質の観測の自己確認 |
| 変える | `eval/p3/run.ts` | `--cond A`、`--review` |
| 変える | `eval/p3/responder/common.sh`・`show.sh` | 役割 `eval` を足す |
| 新規 | `eval/p3/responder/art2.sh`・`plan.sh`・`verdict.sh` | 条件 A の応答の道具 |
| 新規 | `eval/p3/ready/gen-A.txt`・`eval-A.txt` | 応答者への説明 |
| 変える | `eval/p3/make-runs.sh`・`start-runs.sh` | 条件 A の実行ディレクトリ |
| 変える | `eval/general/grade.ts`・`eval/render/grade.ts` | 条件 A の実行を読む、指標を足す |
| 新規 | `src/server/http-channel.ts` | HTTP の推論の接続口 |
| 変える | `src/server/main.ts` | 設定から制作担当・検証担当を作る |
| 新規 | `tests/unit/http-channel.test.ts` | 試験 |
| 新規 | `docs/eval/agent-v1.md` | 条件 A の実行条件の凍結文書 |

触らない: `eval/checks/*.ts`・`eval/gold/`・`eval/tasks/*.json`（判定・参照の作品・課題は変えない）、`eval/p3/cond-d.ts`（条件 D はそのまま残し、同じ課題で比べる）、`docs/eval/` の既存の JSON。

## 3. 性質の観測の自己確認（`eval/agent/probe-self-test.ts`）

推論を使わない。正しいと分かっている作品に `PlaywrightProber.probe` を当て、**重い指摘（blocking）が 1 件も出ない**ことを確かめる。出たら、作品ではなく観測の規則（03）を疑う。

```sh
bun eval/agent/probe-self-test.ts [--port 4790] [--out eval/out/probe-self-test.json]
```

**対象の作品（どれも既存のファイル。書き換えない）:**

| 組 | ファイル | 宣言 | 期待 |
| --- | --- | --- | --- |
| P1 の固定作品 | `fixtures/p1/artworks/` の `falling-block.js`・`breakout.js`・`viz-filter.js`（データは `fixtures/data/synthetic-sales.json`） | なし（`null`） | blocking 0 件 |
| デモのゲーム | `fixtures/demo/artworks/*.js` の 4 件 | なし | blocking 0 件 |
| general-v1 の参照の作品 | `eval/gold/general/*.js` の 8 件（データが要るものは `eval/general/suite.ts` の `generalData`） | なし | blocking 0 件 |
| 描画のデモ | `examples/render/*.js` の 5 件（`libraries` は `examples/render/demos.json` から） | なし | blocking 0 件。重いので、長時間の観測は省かれる |
| 壊れた対照 | `fixtures/p1/artworks/breakout-broken.js` | なし | `P-errors` か、入力のあとのエラーが出る（期待どおり見つかること） |
| dt = 0 の対照 | `tests/e2e/contract-dt0.spec.ts` と同じ `jumper(false)`（スクリプトの中に書く） | Space・ジャンプ・いつでも効く | `P-input-Space` の blocking |
| 正しい対照 | 同じ `jumper(true)` | 同上 | blocking 0 件 |

`eval/gold/` はここ（評価側のスクリプト）からだけ読む。`src/` には持ち込まない。

**すること:**

1. `startApp({ hostPort: port, previewPort: port + 1, devHarness: true })` と `PlaywrightProber` を作る（`eval/general/grade.ts` と同じ形）。
2. 作品ごとに `probe` を呼び、`probeFindings` を取る。
3. 結果を JSON に書く：作品ごとに、組・ファイル名・期待・指摘（重さ・id・文）・`deterministic`・`dtZero.pixels`・`skipped`・`ms`・期待どおりか。最後に、組ごとの「期待どおりの数／全体」と、全体の所要時間。
4. 期待と違う作品が 1 件でもあれば、終了コード 1。

**結果の扱い:** 期待と違ったら、規則を直すか、「この作品でこの指摘が出るのは正しい」と確かめてから期待を直す。どちらにしたかを `docs/eval/agent-v1.md` に書く。warning（`P-dt0`・`P-determinism`）は期待に入れない（件数を記録するだけ）。作品に本当に問題があるかは人が見る。

結果を `docs/eval/probe-v1-self-test.json` として残す（`docs/eval/` に新しいファイルを足すのはよい。既存のファイルは変えない）。

## 4. 評価の実行器に条件 A を足す

### 4.1 `eval/p3/run.ts`

引数:

- `--cond D`（今と同じ）か `--cond A`。
- `--review probes|judge|full`（条件 A のときだけ。既定は `full`）。条件 D では指定できない（指定されたらエラー）。

条件 A のとき:

| 部分 | 条件 D（今） | 条件 A |
| --- | --- | --- |
| 制作担当 | `new DirectModel(gen)` | `new PromptMaker(gen, { label: "agent-maker(stand-in)" })` |
| 検証担当 | なし | `--review` が `judge`・`full` のとき、`new PromptEvaluator(ev, { label: "agent-evaluator(stand-in)" })`。`ev` は `new FileChannel(join(runDir, "solo/eval"), "eval", usage, cond)` |
| 検証 | なし | `new HostReviewer(new PlaywrightProber(app.hostOrigin, (b) => app.tokens.issue(b)), 検証担当か null)` を、`CanvasService` に `review: { reviewer, mode }` で渡す |

- `SeedingModel`（元の作品を版 1 にする前処理）はそのまま使う。**前処理の実行では検証しない。** 元の作品は、修復の課題ではわざと壊してあるので、検証すると指摘が出て、直しの生成が走ってしまう。`run.ts` の中に、検証を包む小さなクラス `SeedSkippingReviewer`（`ReviewerPort` を実装）を作る：`input.request === SEED_REQUEST` のときは、内側の検証を呼ばずに、検査・指摘が空の結果（`failedOutcome` ではなく、`error: null`・`evaluatorCalls: 0`・`ms: 0`）を返す。それ以外は内側の検証にそのまま渡す。`suite`・`close` は内側のものを使う。`CanvasService` には、この包んだ検証を渡す。
- 課題ごとに、検証（`HostReviewer`）は `svc.close()` で閉じる（`CanvasService.close` が閉じる）。`observer.close()` を別に呼んでいる既存の行は、`svc.close()` に置き換える。

**記録（`results.json`）に足す項目:**

`TurnRecord` に:

| 項目 | 中身 |
| --- | --- |
| `evalCalls` | そのターンの検証担当の推論の回数（`ev.calls` の差） |
| `reviews` | 候補ごとに `{ attempt, blocking, findings: [重さ・id・文の先頭 200 文字], evaluatorCalls, ms, error }` |

`TaskRecord` に:

| 項目 | 中身 |
| --- | --- |
| `evalCalls` | 課題全体の検証担当の推論の回数 |
| `finalReview` | 最後に保存した候補の検証の要約 `{ blocking, verdicts: [{ requirement, verdict }], error }`。検証なしなら `null` |

`run.json` に、`cond`、`review`（mode）、`probe: PROBE_SUITE`、`evaluatorSkillDigest`（`docs/evaluator-skill.md` の sha256）、`makerPitfallsDigest` を足す。

時間の数え方：`hostMs` は、制作担当と検証担当の両方の待ち時間を引く（`gen.waitedMs` と `ev.waitedMs` の差の合計）。

### 4.2 応答者の道具（`eval/p3/responder/`）

応答者（代行の Grok Bot）は 2 人になる。**制作担当の応答者と、検証担当の応答者は別の人にする**（同じ人が両方をやると、自己評価と同じになる）。

- `common.sh` の `role_dir`：`gen` に加えて `eval` を受け付ける（`$HZ/solo/eval` を返す）。
- `show.sh`：引数が `eval` のとき、`solo/eval` の要求を表示する。表示の形は今と同じ。
- `art2.sh <id> <title> <entry.js> <meta.json>`（条件 A の制作担当）：`meta.json` は `{ "spec": { "requirements": […], "controls": […] }, "changes": "…", "unconfirmed": […], "reply": "…", "libraries": […], "dataRef": "…" }`（`libraries`・`dataRef` は省略できる）。`jq` で `{ title, entry（ファイルの中身） }` と `meta.json` を合わせ、`atomic_write "$HZ/solo/gen" "$1"` で書く。`reply` が無ければ `changes` と同じ文にする。
- `plan.sh <id> <plan.json>`・`verdict.sh <id> <verdict.json>`（検証担当）：JSON を検査して `atomic_write "$HZ/solo/eval" "$1"` で書く（`write.sh eval <id> <file>` と同じ動き。名前を分けるのは、説明を短くするため）。

### 4.3 応答者への説明（`eval/p3/ready/`）

`gen-common.txt` は今のものを使う。次の 2 つを足す。

**`gen-A.txt`（条件 A の制作担当）** に書くこと:

- 道具は `tools/art2.sh`。`meta.json` の形と例。
- 要求の「出力の形」に `spec` がある。作品を書く前に、要件と操作を数え上げて `spec` に書く。
- ホストの必須の検査に落ちると「前の候補」と「ホスト観測」が、検証で指摘があると「前の候補」と「検証の指摘」が付いた要求が来る（1 ターン 3 回まで）。
- 検証担当の作業場所（`solo/eval`・`work-eval/`）を読まない。

**`eval-A.txt`（検証担当）** に書くこと:

- あなたは検証担当の代行。作品は作らず、直さない。
- 道具は `tools/show.sh eval`（次の要求を表示）、`tools/plan.sh`・`tools/verdict.sh`（応答を書く）。作業場所は `work-eval/`。
- 要求は 2 種類（`eval-plan`・`eval-judge`）。要求の system に手順が全文ある。それに従う。
- 読んではいけないもの：`solo/gen`・`work/`（制作担当の作業場所）、`host/`、ほかの実行ディレクトリ、リポジトリ（`eval/`・`docs/` を含む）。Web・ブラウザ・ほかのエージェントへの相談も不可。
- 作品を自分で実行しない（node・bun で動かさない）。確かめる手段は、要求に書かれた観測と測定だけ。

### 4.4 実行ディレクトリ（`make-runs.sh`・`start-runs.sh`）

- `make-runs.sh [root] [D|A]`：第 2 引数が `A` のとき、`<root>/A-r{1,2,3}` を作る。`solo/gen`・`solo/eval`・`work`・`work-eval`・`tools` を作り、`READY-gen.txt`（`gen-common.txt` ＋ `gen-A.txt`）と `READY-eval.txt`（`eval-A.txt`）を置く。ポートは条件 D と重ならない範囲から振る（例：4721 から 2 ずつ）。
- `start-runs.sh [root] [D|A] [review]`：条件 A のとき、`bun eval/p3/run.ts --cond A --review <review> --suite <suite> …` で起動する。suite は今と同じく引数か環境変数で受ける（今の書き方に合わせる）。

## 5. 集計に足す指標（`eval/general/grade.ts`・`eval/render/grade.ts`）

1. 実行ディレクトリの名前の照合を `^D-r\d+$` から `^[DA]-r\d+$` に広げる。条件ごとに分けて集計する（**条件をまたいで足さない**）。
2. `summary.json` に、条件ごとに次を足す。

| 指標 | 数え方 | 意味 |
| --- | --- | --- |
| `presentedButFailed` | 提示・保存まで進んだ（`presented`）のに、判定で不合格だった件数 | ホストの検査をすり抜けた誤りの数。この計画が減らしたいもの |
| `evaluator.agreement` | `finalReview` がある試行について、「検証で重い指摘が 0 件」を「合格の予想」とし、判定の合否と突き合わせた 4 つの数：`{ bothPass, bothFail, missed, falseAlarm }` | `missed` は「検証は通したが判定は不合格」（見逃し）、`falseAlarm` は「検証は指摘したが判定は合格」（誤検出） |
| `calls` | 制作担当の推論の合計・中央値、検証担当の推論の合計・中央値 | 費用 |
| `hostMs` | 合格した試行の P50・P90 | 待ち時間（応答者の待ちを除く） |

`evaluator.agreement` の見方：`missed` が多ければ検証が甘い（手順書の「甘くしない」を強める、台本の書き方を足す）。`falseAlarm` が多ければ検証が厳しすぎる・観測の規則に偽陽性がある（どの指摘 id が多いかを見る）。手順書を変えたら、**別の評価版**として測り直す。

## 6. 測る順序と、見る数字

1. **自己確認（3 節）を通す。** 推論なし。ここで偽陽性があれば先に直す。
2. **条件 D と条件 A（`--review probes`）を、同じ課題・同じ回数で比べる。** 検証担当なしで、観測だけの効果を見る。
3. **条件 A（`--review full`）を足す。** 検証担当の効果と費用を見る。
4. 課題は、まず **render-v1**（6 課題。まだ 1 回も生成していない）と **general-v1**（10 課題）。general-v1 は条件 D で 30/30 だったので、差が出ない可能性が高い（天井）。差を見るのは render-v1 と、`presentedButFailed`・`calls`・`hostMs`。
5. 1 課題 3 回。上限は plan.md §3.2 と同じ（制作担当は 1 ターン 3 回まで、1 課題 6 回まで）。検証担当の推論は別枠で数える。

実行条件を `docs/eval/agent-v1.md` に凍結してから実行する（書くこと：課題と判定は既存のまま変えないこと、条件 A の構成、上限、数え方、契約・制作手順・検証の手順書・落とし穴の付録の digest、「代行の応答であり実モデルの結果ではない」こと、結果を見たあとで手順書・規則を変えたら別の版にすること）。

**採否の目安（事前に決めておく）:**

| 見る数字 | 採る | 採らない |
| --- | --- | --- |
| 観測（`probes`） | 自己確認で偽陽性 0。条件 D に比べて `presentedButFailed` が減る、または同じで `hostMs` の P90 の増え方が 10 秒以内 | 偽陽性が直せない |
| 検証担当（`full`） | `probes` に比べて合格が増える、または `presentedButFailed` が減る。`missed` と `falseAlarm` の合計が、突き合わせた試行の 2 割以下 | 合格が増えず、推論が 2 倍以上になるだけ |

検証担当を採らない場合でも、観測（`probes`）と宣言（06）は残せる。部品は 1 つずつ足して測る。

## 7. 実モデルの接続（`src/server/http-channel.ts`）

OpenAI 互換の Chat Completions（`POST <baseUrl>/chat/completions`）で呼べるモデルを、06 の `InferenceChannel` として使えるようにする。手元のモデルのサーバー（Ollama・LM Studio・vLLM・llama.cpp など）の多くがこの形で呼べる。**接続先がこの形でない場合は、このファイルだけを別の実装に差し替える**（`PromptMaker`・`PromptEvaluator` は変えなくてよい）。接続先は利用者に確認する（README の 7）。

### 7.1 設定

```ts
export interface HttpChannelOptions {
  baseUrl: string;        // 例 "http://127.0.0.1:11434/v1"
  model: string;          // 接続先でのモデルの名前
  apiKeyEnv?: string;     // API キーを入れた環境変数の名前（キーそのものは設定に書かない）
  temperature?: number;   // 省略時は送らない
  maxTokens?: number;     // 省略時は送らない
  timeoutMs?: number;     // 既定 120_000
  format?: "json" | "fenced"; // 既定 "json"。制作担当には "fenced" も使える（7.3）
}
```

### 7.2 `complete` の動作

1. 送る本文：`{ model, messages: [{ role: "system", content: system ＋ 出力の指示 }, { role: "user", content: prompt }], temperature?, max_tokens? }`。
2. 出力の指示（system の末尾に足す）：`\n\n# 出力\n次の JSON Schema に合う JSON を 1 つだけ返してください。説明やコードの囲みは付けません。\n<outputSchema を JSON にした文字列>`。
3. 見出し：`content-type: application/json`。`apiKeyEnv` があり、その環境変数に値があれば `authorization: Bearer <値>`。
4. `signal` と `timeoutMs` の両方で打ち切れるようにする。
5. 応答の `choices[0].message.content` を文字列として取る。HTTP の状態が 200 番台でない、形が違うときは例外（`"モデルの応答が得られない: <状態> <本文の先頭 200 文字>"`）。**API キーを例外の文・ログに入れない。**
6. 文字列から JSON を取り出す：全体が JSON ならそのまま。```` ``` ```` で囲まれていれば中身。そうでなければ、最初の `{` から最後の `}` までを試す。どれも読めなければ、理由 `"JSON ではない"` で出し直す。
7. `validate` に通す。通らなければ、理由を付けて出し直す：次の要求の `user` の末尾に `\n\n# 前の応答は受け付けられませんでした\n<理由を JSON にした文字列>\n形を直して、もう一度 JSON を 1 つだけ返してください。` を足す。
8. 出し直しは `maxRetries`（既定 2）回まで。超えたら `Error("応答の形が違う（3 回）")`。
9. `maxOutputChars` を超える応答は、理由 `"応答が長すぎる"` で出し直す。

### 7.3 作品の本文を JSON に入れない形（`format: "fenced"`）

コードを JSON の文字列に入れると、エスケープの誤りが増え、コードの質が下がるという報告がある（Aider、2024 年のモデル）。今のモデルでどうかは分からないので、**両方を測って選ぶ**。

`fenced` のときの出力の指示:

```
# 出力
次の 2 つの部分を、この順に、この目印どおりに返してください。ほかの文は書きません。
<<<META
（entry 以外の項目を、次の JSON Schema に合う JSON で）
META
<<<ENTRY
（作品の JavaScript 本文をそのまま。エスケープしない）
ENTRY
```

取り出し方：`<<<META\n` と `\nMETA` の間を JSON として読み、`<<<ENTRY\n` と、**最後の** `\nENTRY` の間を文字列として `entry` に入れる。目印が無ければ `"目印（<<<META・<<<ENTRY）が無い"` で出し直す。出力の指示に載せる Schema からは `entry` を外す。

`fenced` は、出力に `entry` の項目がある要求（制作担当）にだけ使う。検証担当には使わない。

### 7.4 設定から組み立てる（`src/server/main.ts`）

`CanvasConfig.model` の形を広げる。

```ts
model:
  | { provider: "recorded"; label: string; files: string[]; ignoreLatency?: boolean; deliverAfterAbort?: boolean }
  | ({ provider: "openai-compatible"; label: string } & HttpChannelOptions);
/** 検証担当。省略時は検証担当なし（review.mode が judge・full でも観測だけになる）。 */
evaluator?: { provider: "openai-compatible"; label: string } & HttpChannelOptions;
```

- `makeModel`：`provider` が `"openai-compatible"` なら `new PromptMaker(new HttpChannel(設定), { label })`。
- 検証担当：`cfg.evaluator` があれば `new PromptEvaluator(new HttpChannel(設定), { label })` を作り、08 の `HostReviewer` に渡す。
- 既定の `canvas.config.json` は変えない。実モデルの設定は、別のファイル（リポジトリに入れない。例：`canvas.local.json`）に書いてもらう。`.gitignore` に `canvas.local.json` を足す。
- **モデルの名前を、製品のコードやファイル名に書かない**（plan.md §3.2）。名前は設定にだけ書く。

### 7.5 試験（`tests/unit/http-channel.test.ts`）

`fetch` を偽物に差し替えて確かめる（外へ通信しない）。偽の `fetch` は、受け取った要求を覚え、決めた応答を順に返す。

| 試験 | 期待 |
| --- | --- |
| 正しい応答 | 送り先が `<baseUrl>/chat/completions`。本文に `model`、`messages`（system に出力の指示と Schema、user に prompt）。値が返る |
| API キー | 環境変数に値があるとき `authorization` が付く。無いとき付かない。例外の文にキーが入らない |
| 囲みつきの JSON | ```` ```json ```` で囲まれた応答も読める |
| 形の違う応答 | 1 回目が形違い、2 回目が正しい → 2 回呼ばれ、2 回目の user に理由が入っている |
| 3 回とも形違い | 例外 `応答の形が違う（3 回）` |
| HTTP の失敗 | 状態 500 → 例外 `モデルの応答が得られない: 500 …` |
| 中断 | `signal` を中断すると例外 |
| `fenced` | `<<<META … META` と `<<<ENTRY … ENTRY` の応答から、`entry` に本文がそのまま入る（本文に `"` や `\n` があってもそのまま）。目印が無い応答は出し直し |

## 8. 手順

1. 自己確認（3 節）を書いて実行し、偽陽性が無いことを確かめる。結果を `docs/eval/probe-v1-self-test.json` に残す。
2. 実行器・道具・説明・実行ディレクトリ（4 節）を足す。偽の応答（要求を読んで、決めた応答を書くスクリプト）で、条件 A の 1 課題が最後まで流れることを確かめる。
3. 集計（5 節）を足す。
4. `docs/eval/agent-v1.md` を書く（6 節）。
5. HTTP の接続口（7 節）を書く。
6. 利用者に、応答者（制作担当 3 人・検証担当 3 人）の割り当てと、実行の開始を頼む。実行器の起動は `start-runs.sh` で行う（利用者の了解を得てから）。

## 9. 完了の確認

```sh
bun run typecheck
bun run p3:typecheck
bun test tests/unit/http-channel.test.ts tests/unit/general-suite.test.ts tests/unit/render-suite.test.ts
bun eval/agent/probe-self-test.ts
bun run verify
```

`bun eval/agent/probe-self-test.ts` が終了コード 0 で終わること。

## 10. 間違えやすい点

- **判定・課題・参照の作品を変えない。** 条件 A のために `eval/checks/` に手を入れない。条件 D と同じ判定で比べる。
- **検証担当に判定の中身を見せない。** 検証担当の要求に入るのは、依頼・宣言・観測・測定・コード・差分だけ。`eval/checks/` の期待値は入れない。
- **応答者を分ける。** 制作担当の応答者に `solo/eval` を、検証担当の応答者に `solo/gen`・`work/` を読ませない。
- **条件をまたいで平均しない。** 課題群（新規・変更・修復・可視化）もまたいで混ぜない（今の集計と同じ）。
- **代行の応答は実モデルの結果ではない。** 結果の文書の最初に書く（今の結果の文書と同じ）。
- **API キーを設定ファイル・ログ・例外に書かない。** 環境変数の名前だけを設定に書く。
