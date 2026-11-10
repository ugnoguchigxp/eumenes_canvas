# 07 検証担当（Evaluator）：台本・判定・正規化・まとめ役

## 1. 目的

制作担当とは別の推論で、候補が依頼どおりに動くかを確かめる担当を足す。自己評価は甘くなるので、作る担当と確かめる担当を分ける。

検証担当は、自分ではブラウザを操作しない。次の 2 回の推論だけを行う。

1. **台本（plan）**：要件を確かめるために「何を入力し、どこで何を測るか」を書く。ホストがそのとおりに作品を動かし、測定を文にする。
2. **判定（judge）**：ホストの観測（03）と台本の測定を証拠にして、要件ごとに「確認した・満たしていない・未確認」を決め、指摘を書く。

甘い判定を防ぐため、**ホストが規則で縛る**。証拠（観測か測定の id）を引いていない「確認した」は、ホストが「未確認」に書き換える。証拠の無い重い指摘は、軽い指摘に書き換える。

```
観測（03）──┐
            ├─▶ 検証担当：台本 ─▶ ホスト：台本の実行 ─▶ 測定 ──┐
宣言（06）──┘                                              ├─▶ 検証担当：判定 ─▶ ホスト：正規化 ─▶ 検査・指摘
作品のコード・基準との差分 ─────────────────────────────────┘
```

## 2. 触るファイル

| 種類 | ファイル | すること |
| --- | --- | --- |
| 新規 | `src/core/eval-types.ts` | 台本と判定の型、正規化 |
| 新規 | `src/core/line-diff.ts` | 行単位の差分 |
| 新規 | `src/core/script-runner.ts` | 台本 1 本の実行、測定の文 |
| 追記 | `src/core/probes.ts` | `ProbePort.runScripts` と、その実装 |
| 新規 | `src/core/evaluator-port.ts` | 検証担当の接続口の型 |
| 新規 | `src/core/prompt-evaluator.ts` | 検証担当の前置き・出力の形・プロンプト・`PromptEvaluator` |
| 追記 | `src/core/review.ts` | `ReviewMode`・`ReviewInput`・`ReviewOutcome`・`ReviewerPort`（03 で `ReviewFinding` だけ置いたファイル） |
| 新規 | `src/core/host-reviewer.ts` | まとめ役 `HostReviewer` |
| 新規 | `docs/evaluator-skill.md` | 検証の手順書（[drafts/evaluator-skill.md](drafts/evaluator-skill.md) をそのまま置く） |
| 新規 | `tests/unit/eval-types.test.ts`・`line-diff.test.ts`・`host-reviewer.test.ts`・`prompt-evaluator.test.ts`・`script-runner.test.ts` | 試験 |

触らない: `src/core/service.ts`（組み込みは 08）、`src/core/maker-skill.ts`（`loadMakerSkill(path)` をそのまま使って手順書を読む）。

## 3. 仕様：台本と判定の型（`src/core/eval-types.ts`）

### 3.1 台本

```ts
export type Step =
  | { do: "wait"; ms: number }
  | { do: "keyDown"; input: string }
  | { do: "keyUp"; input: string }
  | { do: "tap"; input: string; holdMs: number }
  | { do: "click"; x: number; y: number }
  | { do: "drag"; from: [number, number]; to: [number, number]; ms: number }
  | { do: "shot"; label: string }                    // 画面を測る
  | { do: "track"; color: string; label: string };   // 指定の色のまとまりを測る
export interface Script { id: string; requirement: string | null; purpose: string; seed: number; steps: Step[] }
export interface EvalPlan { scripts: Script[] }
export const PLAN_LIMITS = { scripts: 6, steps: 30, waitMsPerStep: 10_000, waitMsPerScript: 30_000, measuresPerScript: 12 } as const;
```

### 3.2 `normalizePlan(raw: unknown, spec: MakerSpec | null): EvalPlan`

形の合う部分だけを残す。`raw` が物でない、`raw.scripts` が配列でないときは `{ scripts: [] }`。

**手順 1 つの規則（合わなければ、その手順を捨てる）:**

| `do` | 残す条件 | 補う値 |
| --- | --- | --- |
| `wait` | `ms` が 0 以上 10000 以下の数 | 四捨五入 |
| `keyDown`・`keyUp` | `input` が `INPUT_RE` に一致 | |
| `tap` | `input` が `INPUT_RE` に一致 | `holdMs` が 16〜2000 の数ならその値、そうでなければ 50 |
| `click` | `x` が 0〜479、`y` が 0〜359 の数 | 四捨五入 |
| `drag` | `from`・`to` が、範囲内の 2 つの数の配列 | `ms` が 16〜2000 ならその値、そうでなければ 200 |
| `shot` | いつも | `label` が空なら `"画面"`。40 文字まで |
| `track` | `color` が `#` ＋ 16 進 6 桁 | `color` は小文字にする。`label` が空なら色の文字列 |
| それ以外 | 捨てる | |

**台本 1 本の規則:**

1. `steps` が配列でない台本は捨てる。台本は 6 本まで（7 本目以降は捨てる）。
2. 手順を先頭から順に正規化して足していく。足した手順が 30 個になったら、そこで打ち切る。
3. 時間のかかる手順（`wait` の `ms`、`tap` の `holdMs`、`drag` の `ms`）の合計が 30000 を**超える**手順に来たら、その手順を足さずに打ち切る。
4. 測定（`shot`・`track`）は 12 個まで。13 個目以降の測定は捨てる（ほかの手順は続ける）。
5. 測定が 1 つも残らなかった台本は捨てる。
6. 残った台本に、順に `S1`・`S2`… と id を振る（モデルが書いた id は使わない）。
7. `requirement` は、宣言にある要件の id と一致するときだけ残す。そうでなければ `null`。
8. `purpose` は 120 文字まで（無ければ空文字）。`seed` は 0 以上の数ならその値、そうでなければ 1。

### 3.3 判定

```ts
export type VerdictValue = "pass" | "fail" | "unknown";
export interface RequirementVerdict { requirement: string; verdict: VerdictValue; evidence: string[]; note: string }
export interface Issue { severity: "blocking" | "minor"; requirement: string | null; symptom: string; evidence: string[]; suggestion: string }
export interface EvalVerdict { verdicts: RequirementVerdict[]; issues: Issue[]; summary: string }
/** コードを読んだだけの根拠。fail・指摘には使えるが、pass の根拠にはならない。 */
export const CODE_EVIDENCE = new Set(["CODE", "DIFF"]);
```

### 3.4 `normalizeVerdict(raw: unknown, spec: MakerSpec, evidenceIds: ReadonlySet<string>): EvalVerdict`

**これが甘い判定を止める中心の規則である。** 一字一句このとおりに実装する。

「有効な証拠」＝ `evidenceIds` にある id、または `CODE`・`DIFF`。配列でない・文字列でない・有効でない id は捨てる。重複は 1 つにする。8 個まで。

**要件ごとの判定:**

1. `raw.verdicts` の各要素について、`requirement` が宣言にある要件の id でなければ捨てる。同じ要件の 2 つ目以降は捨てる。
2. `verdict` が `"pass"` でも `"fail"` でもなければ `"unknown"`。
3. **`pass` で、有効な証拠の中に `CODE`・`DIFF` 以外が 1 つも無い → `unknown` に変える。** `note` の先頭に `（観測の証拠の引用が無いため未確認に変更）` を足す。
4. **`fail` で、有効な証拠が 1 つも無い → `unknown` に変える。** `note` の先頭に `（証拠の引用が無いため未確認に変更）` を足す。
5. `note` は 300 文字まで。
6. 宣言の要件の順に並べる。判定の無い要件は `{ verdict: "unknown", evidence: [], note: "（判定なし）" }`。

**指摘:**

1. `raw.issues` の各要素について、`symptom` が空でない文字列でなければ捨てる。8 件まで。
2. **`severity` は、`"blocking"` と書かれていて、かつ有効な証拠が 1 つ以上あるときだけ `blocking`。それ以外はすべて `minor`。**
3. `requirement` は、宣言にある要件の id のときだけ残す。そうでなければ `null`。
4. `symptom`・`suggestion` は 300 文字まで（`suggestion` が無ければ空文字）。

`summary` は 400 文字まで。`raw` が物でなければ、すべての要件が `unknown`、指摘は空。

## 4. 仕様：行単位の差分（`src/core/line-diff.ts`）

変更・修復の依頼では、「依頼された点以外を変えていないか」を検証担当が見る。そのための差分を作る。

```ts
export interface LineDiff { added: number; removed: number; text: string; truncated: boolean }
export function lineDiff(before: string, after: string, maxLines = 200): LineDiff;
```

1. 両方を `\r\n` → `\n` に直して行に分ける。
2. どちらかが 4000 行を超えるときは、表を作らずに `{ added: 後の行数, removed: 前の行数, text: "（行数が多いため差分を省略）", truncated: true }`。
3. 最長共通部分列（LCS）の表を作り、先頭からたどって、行ごとに「同じ」「削除」「追加」を決める。同じ長さの選び方があるときは、**削除を先に**出す。
4. `added`・`removed` は、追加・削除の行の数。
5. `text` は、変更のあった行と、その**前後 2 行**だけを並べる。行頭に `+`（追加）・`-`（削除）・半角の空白（同じ）を付ける。1 行は 200 文字まで。飛ばした部分には `…` の 1 行を入れる（連続させない。先頭には入れない）。
6. `text` が `maxLines` 行に達したら打ち切り、`truncated: true`。
7. 差分が無ければ `{ added: 0, removed: 0, text: "", truncated: false }`。

## 5. 仕様：台本の実行（`src/core/script-runner.ts`）

```ts
export interface Measure { id: string; t: number; kind: "shot" | "track"; label: string; text: string }
export interface ScriptResult { id: string; requirement: string | null; purpose: string; measures: Measure[]; errors: string[]; skipped: string | null }
export function runScript(s: HarnessSession, body: ArtworkBody, data: unknown, script: Script): Promise<ScriptResult>;
export function scriptText(results: ScriptResult[]): string;
export function scriptEvidenceIds(results: ScriptResult[]): string[];
```

### 5.1 `runScript`

1. `s.start(body, data, script.seed)`。`ready` でなければ `skipped = "起動しない: " + type` で返す。
2. 手順を順に行う。

   | `do` | すること |
   | --- | --- |
   | `wait` | `s.advance(ms)` |
   | `keyDown`・`keyUp` | `s.keyDown(input)`・`s.keyUp(input)` |
   | `tap` | `s.keyDown(input)` → `s.advance(holdMs)` → `s.keyUp(input)` → `s.advance(0)` |
   | `click` | `s.click(x, y)` → `s.advance(0)` |
   | `drag` | `s.drag(from, to, ms)` |
   | `shot` | 画面を撮る。測定を 1 件足す（下） |
   | `track` | 画面を撮る。測定を 1 件足す（下） |

3. 測定の id は `<台本の id>-<その台本の中の通し番号>`（`S1-1`、`S1-2`…）。`t` は `s.t`（起動から進めた時刻）。
4. `shot` の文：前の `shot` があれば、先頭に `前の shot から変わった画素 <N>（範囲 左上(x,y) 幅w 高さh）。`（差が 0 なら範囲は書かない）。続けて `sceneText(describeScene(画面, 16))`。
5. `track` の文：その色の画素があれば `<色> の画素 <N>、左上(x,y) 幅w 高さh、中心(cx,cy)`。無ければ `<色> の画素は無い`。色の許容差は `blobOf` の既定（30）。
6. 最後に `s.errors()` を 3 件まで。
7. 途中で例外が出たら、`skipped = "実行中の例外: " + 文（200 文字まで）` で、そこまでの測定を返す。

### 5.2 `scriptText`

台本が 0 本なら `（台本の実行は無い）`。それ以外は、台本ごとに次の行を並べる。

```
## S1（要件 R1） Space で跳ぶ
S1-1: [500ms 前] 画面 480×360、背景 #000000。要素 2 個：…
S1-2: [750ms 跳躍中] #00ff00 の画素 400、左上(60,200) 幅20 高さ20、中心(69.5,209.5)
S1-errors: 実行時エラー：frame: boom
## S2 
（時間の上限）
```

- 見出しは `## <id>`、要件があれば `（要件 <id>）`、空白 1 つ、目的。
- `skipped` があれば `（<理由>）` の 1 行。
- 測定は `<測定の id>: [<t>ms <label>] <文>`。
- エラーがあれば `<台本の id>-errors: 実行時エラー：<" / " で繋ぎ、600 文字まで>`。

### 5.3 `scriptEvidenceIds`

各台本の、測定の id の一覧。エラーがある台本は `<台本の id>-errors` も足す。

### 5.4 `ProbePort.runScripts`（`src/core/probes.ts` に足す）

- `ProbePort` に `runScripts(body, data, plan: EvalPlan, signal): Promise<ScriptResult[]>` を足す。
- `PlaywrightProber` の実装：`HarnessSession` を 1 つ開き、台本を順に `runScript` で実行する。全体の実時間が `PROBE.scriptBudgetMs`（30 秒）を超えたら、残りの台本は実行せず `skipped: "時間の上限"`（測定なし）で返す。最後に必ず閉じる。

## 6. 仕様：検証担当の接続口（`src/core/evaluator-port.ts`）

```ts
export interface EvalPlanInput {
  request: string;
  conversation: Turn[];
  hasBase: boolean;      // 基準の作品があるか（変更・修復の依頼か）
  spec: MakerSpec;
  probeText: string;     // 03 の観測の文（画面の要約を含む）
}
export interface EvalJudgeInput {
  request: string;
  conversation: Turn[];
  spec: MakerSpec;
  body: ArtworkBody;     // 作品のコード
  probeText: string;
  scriptText: string;
  diffText: string | null;   // 基準の作品との差分。基準が無ければ null
  evidenceIds: string[];     // 引用できる証拠 id（観測と測定）
}
export interface EvaluatorPort {
  readonly label: string;
  plan(input: EvalPlanInput, signal: AbortSignal): Promise<unknown>;
  judge(input: EvalJudgeInput, signal: AbortSignal): Promise<unknown>;
}
```

- 戻り値は `unknown`。**接続口は正規化しない。** 正規化は、まとめ役（`HostReviewer`）が必ず行う。
- **台本づくりには、作品のコードを渡さない。** 台本は「利用者から見てどう動くべきか」から書かせる。コードを見せると、実装に合わせた台本になる。
- 判定には、コードと差分を渡す。観測では届かない要件（時間のかかる終了条件など）で、実装が明らかに無いことを指摘できるようにするため。ただしコードだけを根拠にした「確認した」は、3.4 の規則で認めない。

## 7. 仕様：検証担当のプロンプト（`src/core/prompt-evaluator.ts`）

### 7.1 手順書（`docs/evaluator-skill.md`）

[drafts/evaluator-skill.md](drafts/evaluator-skill.md) を `docs/evaluator-skill.md` にそのまま置く。`docs/maker-skill.md` と同じ SKILL 形式（先頭に `name`・`description`）。

- `EVALUATOR_SKILL_PATH` = `resolve(import.meta.dir, "../../docs/evaluator-skill.md")`。
- 読み込みは既存の `loadMakerSkill(EVALUATOR_SKILL_PATH)` を使う（どの SKILL 形式の文書でも読める）。

### 7.2 前置きと system

`EVALUATOR_PREAMBLE`（2 行を `"\n"` で繋ぐ）:

```
あなたは Canvas の作品の検証担当です。制作担当とは別の担当で、作品は作らず、直しません。次の検証の手順に従います。
返すのは指定の JSON 一つです。
```

`evaluatorSystem()`：`makerSystemPrompt(手順書, EVALUATOR_PREAMBLE)` の結果のうち、見出し `# 制作手順（<name>）` を `# 検証の手順（<name>）` に置き換えたもの。

### 7.3 出力の形

**台本（`PLAN_SCHEMA`）**

| 項目 | 必須 | 形 |
| --- | --- | --- |
| `scripts` | ○ | 配列、6 本まで |
| `scripts[].requirement` | ○ | 文字列（確かめる要件の id） |
| `scripts[].purpose` | ○ | 文字列、120 文字まで |
| `scripts[].steps` | ○ | 配列、1〜30 個。要素は `do`（必須。`wait`・`keyDown`・`keyUp`・`tap`・`click`・`drag`・`shot`・`track` のどれか）と、`ms`・`input`・`holdMs`・`x`・`y`・`from`・`to`・`color`・`label` |

**判定（`VERDICT_SCHEMA`）**

| 項目 | 必須 | 形 |
| --- | --- | --- |
| `verdicts` | ○ | 配列。要素は `{ requirement, verdict, evidence, note }`（すべて必須）。`verdict` は `pass`・`fail`・`unknown` |
| `issues` | ○ | 配列、8 件まで。要素は `{ severity, requirement?, symptom, evidence, suggestion }`。`severity` は `blocking`・`minor` |
| `summary` | ○ | 文字列、400 文字まで |

### 7.4 プロンプト

各節は空行 1 つで繋ぐ。無い節は飛ばす。

**共通の節の書き方**

- 会話：`## これまでの会話（古い順）\n<1 行ずつ「利用者: …」「制作担当: …」>`（会話があるとき）
- 宣言：

  ```
  ## 制作担当の宣言
  ### 要件
  - R1: Space で跳ぶ
  ### 操作
  - キー Space：ジャンプ（いつでも効く）
  - ポインター：凡例を押して絞り込む（条件つき）
  ```

  操作が無ければ `- （宣言なし）`。

**台本（`planPrompt(input)`）**

| 順 | 節 |
| --- | --- |
| 1 | `## することは台本づくり（plan）\n下の要件のうち、動かして測らないと確かめられないものについて、台本を書いてください。` |
| 2 | `## 依頼（新規）\n<依頼>`。基準があるときは `## 依頼（基準の作品に対する変更・修復）\n<依頼>` |
| 3 | 会話 |
| 4 | 宣言 |
| 5 | `## ホストの観測（各行の先頭が証拠 id）\n<観測の文>` |

作品のコードは入れない。

**判定（`judgePrompt(input)`）**

| 順 | 節 |
| --- | --- |
| 1 | `## することは判定（judge）\n下の要件それぞれについて、観測と測定を証拠にして判定してください。` |
| 2 | 依頼（`diffText` が `null` でなければ「基準の作品に対する変更・修復」） |
| 3 | 会話 |
| 4 | 宣言 |
| 5 | `## ホストの観測（各行の先頭が証拠 id）\n<観測の文>` |
| 6 | `## 台本の測定（各行の先頭が証拠 id）\n<測定の文>` |
| 7 | `## 引用できる証拠\n<証拠 id を ", " で繋ぎ、最後に CODE, DIFF>\n（pass の根拠にできるのは CODE・DIFF 以外）` |
| 8 | `## 基準の作品との差分（証拠 id は DIFF。行頭の + は追加、- は削除）` と、```` ```diff ```` で囲んだ差分（`diffText` があるとき） |
| 9 | `## 作品のコード（証拠 id は CODE）`、`題名: <題名>`、（あれば）`libraries: …`、```` ```js ```` で囲んだ本文 |

### 7.5 `PromptEvaluator`

```ts
export class PromptEvaluator implements EvaluatorPort {
  readonly label: string;
  constructor(channel: InferenceChannel, o?: { label?: string; system?: string });
}
```

- `plan`：`channel.complete({ purpose: "eval-plan", system, prompt: planPrompt(input), outputSchema: PLAN_SCHEMA, maxOutputChars: 16_000 }, 検査, signal)`。検査は「物であり、`scripts` が配列」だけ。
- `judge`：同じ形で、`purpose: "eval-judge"`、`VERDICT_SCHEMA`、検査は「物であり、`verdicts` が配列」だけ。
- 細かい形の検査はしない（3.2・3.4 の正規化が受け持つ）。

## 8. 仕様：検証の接続口とまとめ役

### 8.1 `src/core/review.ts` に足す

```ts
/** off：検証しない（従来どおり）。probes：ホストの性質の観測だけ。judge：観測＋検証担当の判定 1 回。full：観測＋検証担当の台本と判定。 */
export type ReviewMode = "off" | "probes" | "judge" | "full";

export interface ReviewInput {
  request: string;
  conversation: Turn[];
  base: ArtworkBody | null;
  body: ArtworkBody;
  data: unknown;
  spec: MakerSpec | null;
  mode: Exclude<ReviewMode, "off">;
}
export interface ReviewOutcome {
  suite: string;
  environment: string;
  checks: CheckResult[];       // 検証記録に足す検査。level は advisory か matched
  findings: ReviewFinding[];
  verdict: EvalVerdict | null;
  evaluatorCalls: number;      // 検証担当の推論の回数
  ms: number;
  error: string | null;        // 検証そのものが途中で失敗した理由（候補の失敗ではない）
}
export interface ReviewerPort {
  readonly suite: string;
  review(input: ReviewInput, signal: AbortSignal): Promise<ReviewOutcome>;
  close(): Promise<void>;
}
```

### 8.2 `src/core/host-reviewer.ts`

```ts
export class HostReviewer implements ReviewerPort {
  constructor(lab: ProbePort, evaluator: EvaluatorPort | null);
}
export function verdictChecks(v: EvalVerdict): CheckResult[];
export function verdictFindings(v: EvalVerdict, spec: MakerSpec): ReviewFinding[];
```

`suite` は `lab.suite`。`close()` は `lab.close()`。

**`review(input, signal)` の手順:**

1. 観測：`report = await lab.probe(input.body, input.data, input.spec, signal)`。結果の `checks` = `probeChecks(report)`、`findings` = `probeFindings(report)`、`environment` = `report.environment`。
2. 次のどれかなら、ここで返す（検証担当は呼ばない）。
   - `input.mode === "probes"`
   - `report.booted` が偽
   - `evaluator` が `null`
   - `input.spec` が `null`（このときは `error = "制作担当の宣言（spec）が無いため、検証担当の判定を省いた"`）
3. `pText = probeText(report)`。
4. **台本（`mode === "full"` のときだけ）。** `evaluatorCalls` を 1 増やす → `evaluator.plan({ request, conversation, hasBase: input.base があるか, spec, probeText: pText }, signal)` → `normalizePlan(結果, spec)` → 台本が 1 本以上あれば `lab.runScripts(body, data, plan, signal)`。
   - この段階で例外が出たら：`signal` が中断されていれば投げ直す。そうでなければ `error = "台本の段階で失敗: " + 文` とし、**測定なしで判定へ進む**。
5. **判定。** `evaluatorCalls` を 1 増やす → `evidenceIds` = `probeEvidenceIds(report)` ＋ `scriptEvidenceIds(測定)` → 基準があれば `lineDiff(base.entry, body.entry)` から `diffText` を作る（`追加 <a> 行・削除 <r> 行`、打ち切りなら `（長いので途中まで）`、改行、差分の文）→ `evaluator.judge(…)` → `normalizeVerdict(結果, spec, new Set(evidenceIds))`。
   - `verdict` を結果に入れ、`checks` に `verdictChecks(verdict)` を、`findings` に `verdictFindings(verdict, spec)` を足す。
   - この段階で例外が出たら：中断なら投げ直す。そうでなければ `error` に `"判定の段階で失敗: " + 文` を足す（前の `error` があれば ` ／ ` で繋ぐ）。500 文字まで。
6. `ms` に実時間を入れて返す。

**`verdictChecks`：** 要件ごとに 1 件。`{ id: "req:<要件の id>", level: "matched", pass: 判定が pass か, detail }`。`detail` は、`確認した`・`満たしていない`・`未確認` のどれかに、`note` があれば `：` と `note` を続ける（300 文字まで）。

**`verdictFindings`：**

1. 指摘（`issues`）を順に 1 件ずつ。`source: "evaluator"`、`severity` は `blocking` → `blocking`、`minor` → `warning`、`id` は `E-1`・`E-2`…。文は、（要件があれば）`[<要件の id>] `、症状、（案があれば）`／直し方の案：<案>`、（証拠があれば）`（証拠: <", " で繋ぐ>）`。
2. 続けて、判定が `fail` の要件のうち、**同じ要件の指摘が 1 件も無いもの**を、重い指摘として足す。`id` は `E-req-<要件の id>`。文は `[<要件の id>] 要件「<要件の文>」を満たしていない`、（`note` があれば）`：<note>`、（証拠があれば）`（証拠: …）`。

## 9. 手順

1. `eval-types.ts`・`line-diff.ts` を書き、試験を通す。
2. `script-runner.ts` を書く。`probes.ts` に `runScripts` を足す。
3. `evaluator-port.ts`、`review.ts` の追加分を書く。
4. `docs/evaluator-skill.md` を置き、`prompt-evaluator.ts` を書く。
5. `host-reviewer.ts` を書き、試験を通す。

## 10. 試験

### 10.1 `tests/unit/eval-types.test.ts`

宣言は「R1: Space で跳ぶ」「R2: 得点が増える」。

| 試験 | 入力 | 期待 |
| --- | --- | --- |
| 台本の正規化 | 台本 4 つ：①要件 R1、手順が `wait 500`・`shot 前`・`tap Space`（`holdMs` なし）・`wait 200`・`track #00FF00 自機`・`do: "eval"`・`click x: 9999` ②測定の無い台本 ③要件 R9、手順が `drag [10,10]→[100,50]`（`ms` なし）・`shot`（ラベルなし）・`wait 20000`・`wait 9000`・`wait 9000`・`shot 切られる` ④文字列 | 残るのは 2 本。1 本目は id `S1`、要件 `R1`、`seed: 1`、手順 5 個（`tap` の `holdMs` は 50、`track` の色は `#00ff00`）。2 本目は id `S2`、要件 `null`、手順は `drag`（`ms: 200`）・`shot`（ラベル `画面`）・`wait 9000`・`wait 9000`・`shot 切られる`（`wait 20000` は 1 手順の上限超えで捨てる） |
| 本数の上限 | `shot` だけの台本 10 本 | 6 本 |
| 時間の上限 | `wait 10000` を 3 回、`wait 1`、`shot` | 0 本（合計が 30000 を超える `wait 1` で打ち切られ、測定が残らない） |
| 形の違う入力 | `null` | `{ scripts: [] }` |
| 判定の正規化 | 証拠 id は `P-input-Space`・`S1-2`。判定：R1 が `pass`（証拠 `CODE` だけ）、R2 が `fail`（証拠 `CODE`）、R7 が `pass`。指摘：①`blocking`・R1・証拠 `P-input-Space` と存在しない id ②`blocking`・証拠なし ③`severity: "weird"`・証拠 `S1-2` ④症状が空 | R1 は `unknown` で、`note` が `（観測の証拠の引用が無いため未確認に変更）` で始まる。R2 は `fail` のまま（証拠 `CODE`）。判定は 2 件。指摘は 3 件で、順に `[blocking, R1, [P-input-Space]]`・`[minor, null, []]`・`[minor, null, [S1-2]]` |
| 観測の証拠つきの pass | R1 が `pass`（証拠 `S1-2` と `CODE`）、R2 は判定なし | R1 は `pass`、R2 は `unknown` で `note` が `（判定なし）` |
| 形の違う入力 | 文字列 | すべての要件が `unknown` |

### 10.2 `tests/unit/line-diff.test.ts`

| 入力 | 期待 |
| --- | --- |
| 10 行（`l1`〜`l10`、4 行目が `const INTERVAL = 500;`）と、4 行目を `900` に変えて `l11` を足した 11 行 | `added: 2`、`removed: 1`、`truncated: false`。`text` は次の 10 行：` l2`、` l3`、`-const INTERVAL = 500;`、`+const INTERVAL = 900;`、` l5`、` l6`、`…`、` l9`、` l10`、`+l11` |
| 同じ文字列どうし | `{ added: 0, removed: 0, text: "", truncated: false }` |
| すべての行が違う 300 行どうし、`maxLines = 50` | `truncated: true`、`text` が 50 行 |

### 10.3 `tests/unit/script-runner.test.ts`

`scriptText` と `scriptEvidenceIds` を、手で作った結果で確かめる（ブラウザなし）。

- 結果が空 → `（台本の実行は無い）`。
- 5.2 の例の入力 → 5.2 の例の文と一致。証拠 id は `S1-1`・`S1-2`・`S1-errors`。

`runScript` の実ブラウザでの確認は、`tests/unit/prober.test.ts`（03）に 1 つ足す：`jumper(true)` の作品に、台本「`shot 前` → `tap Space` → `wait 150` → `track #00ff00 跳躍中`」を `runScripts` で実行し、測定が 2 件で、2 件目の文に `#00ff00 の画素` と、起動時より小さい y（跳んでいる）が出ること。

### 10.4 `tests/unit/prompt-evaluator.test.ts`

| 試験 | 期待 |
| --- | --- |
| 手順書 | `name` が `canvas-artwork-evaluator`。本文に `## 目的`・`## 役割の分離`・`## 台本を書くとき（plan）`・`## 判定するとき（judge）`・`## 指摘（issues）`・`## 情報・道具の安全性`・`## 完成条件` がある。`pass は、観測か台本の測定`、`証拠の無い pass は、ホストが unknown に書き換える`、`証拠の無い blocking は、ホストが minor に書き換える`、`幅 480・高さ 360` を含む |
| system | `# 検証の手順（canvas-artwork-evaluator）` を含む。`格子`、`host-smoke`、`host-probe`、`heldout`、`general-v1`、`eval/`、`commit` が無い |
| 台本のプロンプト | `- R1: Space で跳ぶ`、`- キー Space：ジャンプ（いつでも効く）`、観測の文を含む。```` ```js ```` を含まない（コードを渡さない） |
| 判定のプロンプト | `## 引用できる証拠\nP-scene, S1-1, CODE, DIFF`、差分の囲み、コードの囲み、会話の行を含む |
| `PromptEvaluator` | 偽の接続口で、`purpose` が順に `eval-plan`・`eval-judge`。配列を持たない応答では例外 |

### 10.5 `tests/unit/host-reviewer.test.ts`

偽の観測室（`ProbePort`：決めた観測と測定を返す）と、偽の検証担当（決めた台本と判定を返す。`"throw"` なら例外）を使う。観測は 03 の試験の `report()` と同じ補助関数で作る。

| 試験 | 期待 |
| --- | --- |
| `probes` | 検証担当を呼ばない。`evaluatorCalls` が 0。指摘は観測の指摘だけ。`verdict` は `null` |
| `full`（基準あり） | `evaluatorCalls` が 2。台本が実行される。台本の入力の `hasBase` が真。判定の入力の `evidenceIds` が、観測の id と測定の id を順に繋いだもの。`diffText` に `追加 1 行・削除 1 行` を含む。判定「R1 は pass（証拠 `S1-2`・`P-input-Space`、`note`: y が 280 → 200）、R2 は fail（証拠 `CODE`、`note`: KeyR の処理が無い）、指摘なし」に対して、`matched` の検査が `{ id: "req:R1", pass: true, detail: "確認した：y が 280 → 200" }` と `{ id: "req:R2", pass: false, detail: "満たしていない：KeyR の処理が無い" }`。指摘は 1 件 `{ source: "evaluator", severity: "blocking", id: "E-req-R2", message: "[R2] 要件「R キーでやり直す」を満たしていない：KeyR の処理が無い（証拠: CODE）" }` |
| `judge` | `evaluatorCalls` が 1。台本を呼ばない。`diffText` は `null`。観測の指摘（宣言したキーに効果なし）と、判定の指摘（`blocking`・R1、`minor`）で、指摘は順に `[probe, blocking, P-input-Space]`・`[evaluator, blocking, E-1]`・`[evaluator, warning, E-2]`。R1 の `fail` は、同じ要件の指摘があるので二重に足さない。`E-1` の文は `[R1] Space で跳ばない／直し方の案：dt > 0 のときだけ物理を進める（証拠: P-input-Space）` |
| 台本も判定も失敗 | 観測の指摘は返る。`error` が `台本の段階で失敗: plan failed ／ 判定の段階で失敗: judge failed`。`evaluatorCalls` が 2 |
| 宣言なし | `evaluatorCalls` が 0。`error` に `宣言（spec）が無い` を含む |
| 検証担当なし | `evaluatorCalls` が 0。観測の指摘は返る |
| 起動しない作品 | 検査・指摘が空。`evaluatorCalls` が 0 |
| `close` | 観測室が閉じられる |

## 11. 完了の確認

```sh
bun run typecheck
bun test tests/unit/eval-types.test.ts tests/unit/line-diff.test.ts tests/unit/script-runner.test.ts tests/unit/prompt-evaluator.test.ts tests/unit/host-reviewer.test.ts
bun test tests/unit/prober.test.ts
bun run verify
```

## 12. 間違えやすい点

- **正規化を飛ばさない。** `HostReviewer` の外で、検証担当の生の出力を使わない。
- **「確認した」の規則を緩めない。** `CODE`・`DIFF` だけの `pass` を認めると、検証担当が「コードではそうなっている」と書いて全部通す。これが一番起きやすい失敗である。
- **証拠 id の集合は、その候補の観測と測定から作る。** 前の候補の id を混ぜない。
- **台本づくりにコードを渡さない。** `EvalPlanInput` に作品の本文を足さない。
- **検証担当の失敗で検証全体を止めない。** 台本が失敗しても判定へ進む。判定が失敗しても、観測の指摘は返す。
- **検証担当は直さない。** 直し方の案は 1 文。コードを返させない（出力の形にコードの項目を作らない）。
- **手順書に書いてはいけないもの。** 観測の固定点、評価のメタデータ、判定のコードの中身。試験（10.4）が照合する。
