# 08 制作のループに検証を組み込む

## 1. 目的

`CanvasService` の制作のループ（`execute`）に、検証（07 の `ReviewerPort`）を組み込む。

- 必須の検査（契約・ホスト観測）に通った候補を検証する。
- **重い指摘（blocking）があり、試行が残っていれば**、指摘を制作担当に返して直させる。
- 最後に、必須の検査に通った候補のうち、**重い指摘が最も少ないもの**を提示する。
- 検証は保存を止めない。必須の検査に通っていれば、指摘が残っていても保存できる（利用者が指摘を見て決める）。

検証を設定で有効にしない限り、動作は今と同じである。

## 2. 触るファイル

| 種類 | ファイル | すること |
| --- | --- | --- |
| 変える | `src/core/types.ts` | `Observation.kind` に 2 つ足す。`Candidate` に `spec`・`review` |
| 追記 | `src/core/review.ts` | `CandidateReview`、`blockingCount`、`findingsAsObservations`、`failedOutcome` |
| 変える | `src/core/service.ts` | `ServiceOptions.review`、`execute` の書き直し、`candidateView`、`close` |
| 変える | `src/server/main.ts` | 設定 `review` を読み、検証を組み立てる |
| 変える | `src/host/index.html`・`src/host/app.js`・`src/host/app.css` | 候補の表示に、宣言・判定・指摘を足す |
| 新規 | `tests/unit/review-loop.test.ts` | 試験 |

触らない: `save`・`restore`・`resolvePreview`・`startRun`・`cancelRun`（保存・復元・取消の規則は変えない）、`src/core/store.ts`（足す項目は省略できるので、保存済みの `store.json` はそのまま読める）、`scripts/seed-demo.ts`（検証を渡さないので今と同じ）。

## 3. 仕様：型の追加

### 3.1 `src/core/types.ts`

```ts
export interface Observation {
  /** probe・evaluator は検証（review）の指摘。必須の検査には通っている。 */
  kind: "contract" | "runtime-error" | "boot-timeout" | "blank" | "static" | "model-error" | "probe" | "evaluator";
  message: string;
}

export interface Candidate {
  // …既存の項目…
  /** 制作担当の宣言（要件と操作）。宣言が無い・形が違うときは null。 */
  spec?: MakerSpec | null;
  /** 検証（review）の要約。検証しなかった候補は null。 */
  review?: CandidateReview | null;
}
```

`CheckLevel` の `advisory` と、`makeVerification` の必須の段階の数え方は、03 で済んでいる。

### 3.2 `src/core/review.ts` に足す

```ts
/** 候補に残す検証の要約。 */
export interface CandidateReview {
  mode: ReviewMode;
  suite: string;
  blocking: number;            // 重い指摘の数
  findings: ReviewFinding[];   // 40 件まで
  verdict: EvalVerdict | null;
  evaluatorCalls: number;
  ms: number;
  error: string | null;
}
```

| 関数 | 仕様 |
| --- | --- |
| `blockingCount(findings): number` | `severity === "blocking"` の数 |
| `findingsAsObservations(findings): Observation[]` | 制作担当に返す指摘。**info は渡さない。** 残りを先頭から 12 件。`kind` は指摘の `source`（`"probe"` か `"evaluator"`）。`message` は、blocking なら `[要修正] <文>`、warning なら `[注意] <文>`（1200 文字まで） |
| `failedOutcome(suite, error, ms): ReviewOutcome` | 検証そのものが失敗したときの結果。`environment: "none"`、検査・指摘は空、`verdict: null`、`evaluatorCalls: 0`、`error` は 500 文字まで |

## 4. 仕様：サービス（`src/core/service.ts`）

### 4.1 設定と定数

```ts
export interface ServiceOptions {
  // …既存の項目…
  /** 候補の検証。省略・mode が off なら従来どおり（必須の検査に通った最初の候補を提示する）。 */
  review?: { reviewer: ReviewerPort; mode: ReviewMode; maxReviews?: number };
}
/** 期限までの残りがこれより短いときは検証を始めない。 */
export const REVIEW_MIN_REMAINING_MS = 45_000;
```

- `maxReviews` の既定は `MAX_FIX_ATTEMPTS + 1`（= 3。すべての試行を検証できる数）。
- `MAX_FIX_ATTEMPTS`（初回 1 回＋修正 2 回）と `MAX_TURN_INFERENCES` は変えない。**制作担当の推論の回数の上限は今と同じ。**

### 4.2 `execute` の流れ

いまの `execute` を、次の流れに書き直す。**太字が今との違い**である。

```
review   = 設定の review（mode が off なら無いものとして扱う）
reviewsUsed = 0
best     = なし          // 必須の検査に通った候補のうち、重い指摘が最も少ないもの
previous = なし、previousPassed = false、observations = []

試行 attempt = 0, 1, 2 について:
  1. 実行が生きていなければ終わる（live）
  2. 制作担当を呼ぶ（入力に previousPassed を足す）
       例外のとき：生きていなければ終わる。
                   best があれば best を提示して終わる。        ← 違い
                   無ければ「生成に失敗」で失敗にする
  3. 生きていなければ終わる。attempts を記録する
  4. 候補を作る。spec = normalizeSpec(out.spec)、review = null   ← 違い
  5. 必須の検査:
       契約に落ちた      → checks = [契約の不合格]、observations = 契約のエラー（01 の位置つき）
       未登録の dataRef  → checks = [契約の不合格]、observations = その文
       それ以外          → ホスト観測。checks = [契約の合格, …観測の検査]、
                           observations = 観測の文（01 の該当行つき）
                           観測が例外のとき：生きていなければ終わる。
                                             best があれば best を提示して終わる。 ← 違い
                                             無ければ「観測に失敗」で失敗にする
  6. requiredOk = 必須の段階（contract・loaded・operated）がそろい、すべて合格か
  7. 検証（次のすべてを満たすときだけ）:                          ← 違い
       requiredOk、review がある、reviewsUsed < maxReviews、
       期限までの残り（run.deadline − 今）が REVIEW_MIN_REMAINING_MS 以上
     → reviewsUsed を 1 増やす
     → outcome = reviewer.review({ request, conversation, base, body, data, spec, mode })
          例外のとき：outcome = failedOutcome(suite, 例外の文, かかった時間)
                     （検証の失敗は、候補の失敗にしない）
     → 生きていなければ終わる
     → 候補の review に要約を入れる（blocking = blockingCount(outcome.findings)）
  8. 検証記録を作る：makeVerification(digest, dataDigest, environment,
                                     [...checks, ...(outcome の checks)])
     候補と検証記録を保存する（**ここでは実行の状態を変えない**）       ← 違い
  9. previous = この候補、previousDigest = この digest
 10. 必須の検査に落ちていたら：previousPassed = false。次の試行へ
 11. blocking = 候補の review があればその blocking、無ければ 0       ← 違い
     best が無い、または blocking <= best の blocking なら、best = この候補
 12. outcome が無い、または blocking が 0 なら、ループを抜ける          ← 違い
 13. previousPassed = true、observations = findingsAsObservations(outcome.findings)
     次の試行へ

ループのあと:
  生きていなければ終わる
  best があれば best を提示する（presentedCandidateId・state = "presented"・finishedAt）
  無ければ「修正の上限（初回＋2 回）に達した」で失敗にする
```

確かめておく性質:

- **検証が無い・`off` のとき**：7 を飛ばすので `outcome` は無く、11 で `best` に入り、12 で抜け、すぐ提示する。今と同じ結果になる。
- **重い指摘が 0 のとき**：その候補で抜けて提示する。warning・info だけでは直させない。
- **同数なら後の候補**を選ぶ（11 の `<=`）。直したあとの候補を優先する。
- **検証していない候補は、重い指摘 0 件として扱う。** 回数の上限・期限の都合で検証できなかった候補は、直前の指摘を受けて直したものなので、後の候補を優先する。画面には「検証なし」と出す（6 節）。
- **直した候補が必須の検査に落ちたとき**：その観測を返して次の試行へ進む（10）。`best` は前の候補のまま残る。
- 「生きていなければ終わる」は、いまの `this.live(runId)` と同じ（取消・期限切れ・撤回のあとに届いた結果は採用しない）。

### 4.3 `candidateView`

返す物に、`spec: c.spec ?? null` と `review: c.review ?? null` を足す。

### 4.4 `close`

`await this.o.observer.close();` の次に、`await this.o.review?.reviewer.close();` を足す。

## 5. 仕様：設定と組み立て（`src/server/main.ts`）

`CanvasConfig` に足す。

```ts
/** 候補の検証。省略時は off。 */
review?: { mode: "off" | "probes" | "judge" | "full"; maxReviews?: number };
```

`runFromConfig` の `makeService` の中:

- `cfg.review` が無い、または `mode` が `"off"` → `CanvasService` に `review` を渡さない（今と同じ）。
- それ以外 → `new HostReviewer(new PlaywrightProber(hostOrigin, (b) => tokens.issue(b), cfg.observerArgs ?? []), evaluator)` を作り、`{ reviewer, mode, maxReviews }` を渡す。
- `evaluator` は、この冊では `null`（09 で、設定から検証担当を作って渡す）。`null` のままでも、`probes` と同じ動き（観測だけ）になる。

既定の `canvas.config.json` は**変えない**（検証は off のまま）。試すときは、別の設定ファイルを作って `bun src/server/main.ts <設定ファイル>` で起動してもらう（起動は利用者が行う）。

記録済み推論（`recorded`）と検証を一緒に使うと、重い指摘が出たときの「直しの生成」は記録に無いので失敗する。そのときは 4.2 の 2 の規則で、最初の候補がそのまま提示される（実行は失敗にならない）。

## 6. 仕様：画面（`src/host/index.html`・`app.js`・`app.css`）

候補の欄（`#candidate`）に、検証の結果を足す。**既存の要素と文面は変えない**（既存の Playwright の試験が照合している）。

### 6.1 要素

`index.html` の `<ul id="cand-checks"></ul>` の次に足す。

```html
<div id="cand-review" hidden>
  <div id="cand-review-head"></div>
  <ul id="cand-requirements" aria-label="要件ごとの判定"></ul>
  <ul id="cand-findings" aria-label="検証の指摘"></ul>
</div>
```

### 6.2 表示の規則（`app.js` の `showCandidate`）

1. **必須の検査の一覧（`#cand-checks`）には、`level` が `contract`・`loaded`・`operated` の検査だけを出す。** `matched`・`advisory` の検査は、ここには出さない（「不合格」と並ぶと、保存できない候補に見える）。文面は今と同じ。
2. `c.review` が `null`・無い → `#cand-review` を隠す。
3. `c.review` がある → `#cand-review` を出す。
   - 見出し（`#cand-review-head`）：`検証（<mode>）：要修正 <blocking> 件`。`review.error` があれば、続けて `／検証の一部が失敗：<error>`。
   - 要件（`#cand-requirements`）：`c.spec` と `review.verdict` があるとき、要件ごとに 1 行。`<要件の id> <要件の文> — <確認した｜満たしていない｜未確認><note があれば「：note」>`。行のクラスは `pass`・`fail`・`unknown`。`verdict` が無いとき（`probes` など）は、`c.spec` の要件を `<id> <文> — 未確認` で並べる。`c.spec` も無ければ空。
   - 指摘（`#cand-findings`）：`review.findings` を 1 行ずつ。`[要修正]`・`[注意]`・`[参考]` を頭に付ける。行のクラスは `blocking`・`warning`・`info`。
4. 保存のボタンの有効・無効は**今と同じ**（`c.verification?.requiredPassed`）。指摘が残っていても、必須の検査に通っていれば押せる。
5. `#cand-unconfirmed` は今と同じ。

文字は `textContent` で入れる（`innerHTML` を使わない。制作担当・検証担当の文をそのまま出すため）。

`app.css` に、`#cand-review` の中の行の色を足す（`fail`・`blocking` は既存の `.fail` と同じ色、`warning` は黄系、`unknown`・`info` は既存の `.note` と同じ薄い色）。

## 7. 手順

1. `types.ts`・`review.ts` に 3 を足す。
2. `service.ts` を 4 のとおりに変える。**先に `tests/unit/service.test.ts` を動かし、通ることを確かめてから**、`review-loop.test.ts` を書く。
3. `main.ts` を 5 のとおりに変える。
4. 画面を 6 のとおりに変える。
5. `design.md` §3 に、この冊の動作を 1 項目として足す（検証の段階、指摘があるときの直し、最良の候補の選び方、保存の必須にしないこと）。`plan.md` §6 の残作業に 1 行足す。

## 8. 試験（`tests/unit/review-loop.test.ts`）

ブラウザを使わない。次の 2 つの偽物を試験ファイルの中に作る。観測は `tests/unit/support.ts` の `FakeObserver`、実行は `runToEnd` を使う。

- **決めた応答を返す制作担当**：試行の番号ごとに応答を決めておく。`"throw"` なら `ModelError` を投げる。渡された入力を覚える。作品は `canvasApp.start((api) => ({ frame() { /* v<n> */ } }));`（試行ごとに違う本文）。宣言は「要件：Space で跳ぶ／操作：Space・ジャンプ・いつでも効く」。
- **決めた指摘を返す検証**：呼ばれた順に指摘の配列を決めておく。`"throw"` なら例外。検査は `{ id: "probe:dt0", level: "advisory" }` と `{ id: "req:R1", level: "matched" }` の 2 件（指摘が空なら合格）。`evaluatorCalls: 2`。

指摘の例：`BLOCK`（probe・blocking・`P-input-Space`・「宣言した操作 Space が画面に差を生まない」）、`WARN`（evaluator・warning・「得点の位置が依頼と違う」）、`INFO`（probe・info）。

| 試験 | 設定 | 期待 |
| --- | --- | --- |
| 指摘なし | 検証は `[INFO]` | `presented`、試行 1 回。検査の段階が順に `contract`・`loaded`・`operated`・`advisory`・`matched`。`requiredPassed` が真。候補の `spec` が正規化された形（`R1`）。`review` が `{ mode: "full", suite, blocking: 0, evaluatorCalls: 2, error: null }`。検証の入力に依頼・`mode`・`base: null`・`spec`。保存できる |
| 助言は保存を止めない | 検証は 3 回とも `[BLOCK]` | `presented`。提示された候補に不合格の `advisory` の検査があり、`requiredPassed` は真。保存できる |
| 重い指摘で直させる | 検証は `[BLOCK, WARN, INFO]` → `[]` | 試行 2 回、候補 2 件、提示は 2 件目。制作担当の 2 回目の入力：`previousPassed` が真、`previous` が 1 件目の作品、`observations` が `[{ kind: "probe", message: "[要修正] 宣言した操作 Space が画面に差を生まない" }, { kind: "evaluator", message: "[注意] 得点の位置が依頼と違う" }]`（info は無い）。1 回目の入力の `previousPassed` は偽 |
| warning だけ | 検証は `[WARN]` | 試行 1 回で `presented` |
| 最後まで残る（数が違う） | 重い指摘の数が 1 件 → 2 件 → 2 件 | 試行 3 回。提示は 1 件目 |
| 最後まで残る（同数） | 3 回とも 1 件 | 提示は 3 件目 |
| 直しの生成が失敗 | 制作担当の 2 回目が `"throw"`、検証は `[BLOCK]` | `presented`、候補 1 件、`failure` は `null` |
| 直した候補が必須の検査に落ちる | 観測が 2 件目の作品だけ不合格（`frame: boom`）。検証は `[BLOCK]` → `[BLOCK]` | 試行 3 回。3 回目の入力は `previousPassed` が偽、`observations` が `[{ kind: "runtime-error", message: "frame: boom" }]`。検証が呼ばれたのは 2 回（落ちた候補は検証しない）。2 件目の `review` は `null`。提示は 3 件目 |
| 検証そのものが失敗 | 検証が `"throw"` | `presented`。`review` が `{ blocking: 0, error: "reviewer crashed" }` |
| 回数の上限 | `maxReviews: 1`、検証は `[BLOCK]` | 検証は 1 回だけ。2 件目の `review` は `null`。提示は 2 件目 |
| 期限が近い | `runTimeoutMs: 30_000` | `presented`。検証は呼ばれない。`review` は `null` |
| `off`・検証なし | `mode: "off"`、宣言なしの応答 | `presented`。検証は呼ばれない。`spec` は `null`。検査の段階は `contract`・`loaded`・`operated` だけ |
| 必須の検査に 3 回落ちる | 観測が 3 件とも不合格 | `failed`、`failure` に `修正の上限` を含む |
| 構文エラーの観測 | 1 回目が構文エラーの作品（2 行目に `if (1 > ) {}`） | 2 回目の入力の `observations[0]` が `kind: "contract"` で、文が `構文エラー: … ／ …（作品の 2 行 <列> 列）［該当行: return { frame() { if (1 > ) {} } };］` の形 |
| `close` | — | 検証の `close` が呼ばれる |

## 9. 完了の確認

```sh
bun run typecheck
bun test tests/unit/service.test.ts tests/unit/single-user.test.ts tests/unit/recorded.test.ts tests/unit/seed-demo.test.ts
bun test tests/unit/review-loop.test.ts
bunx playwright test tests/e2e/p1-flow.spec.ts tests/e2e/single-user.spec.ts
bun run verify
```

既存の 4 つの単体試験と Playwright の試験が、期待値を 1 つも変えずに通ること。

検証つきの動作を実際の画面で見るときは、`"review": { "mode": "probes" }` を足した別の設定ファイルを用意し、利用者に検証ホストの起動を頼む。デモの作品（「テトリスを作って」など）で、候補の欄に検証の見出しと指摘が出ること、保存できることを見る。

## 10. 間違えやすい点

- **提示は最後に 1 回だけ。** いまは、必須の検査に通った時点で、候補の保存と同じ処理の中で `presented` にしている。変更後は、候補の保存（4.2 の 8）と提示（ループのあと）を分ける。途中で `presented` にすると、利用者が候補を保存したあとで別の候補に差し替わる。
- **検証の例外で実行を失敗にしない。** 制作担当・ホスト観測の例外は実行の失敗（`best` が無いとき）、検証の例外は「検証の一部が失敗」として候補に残すだけ。
- **`requiredPassed` に助言を混ぜない。** 03 の変更（必須の段階を名前で数える）が入っていることを確かめる。「助言は保存を止めない」の試験が守る。
- **検証していない候補の `review` は `null`。** 空の要約を入れない（画面で「検証なし」と区別する）。
- **制作担当に info を返さない。** 単色の終了画面のような「依頼どおりかもしれないこと」を直させない。
- **推論の回数。** 制作担当は 1 ターン最大 3 回（今と同じ）。検証担当は 1 候補につき最大 2 回、1 ターン最大 6 回。plan.md §3.2 の「独立した意味評価は別枠で最大 1 回」とは条件が違うので、検証つきで測るときは**別の評価版**として記録する（09）。
