# 06 制作担当（Maker）：要件と操作の宣言、プロンプト、落とし穴の付録

## 1. 目的

制作担当が作品と一緒に**宣言（spec）**を返すようにする。宣言は 2 つの一覧である。

- **要件**：依頼に書かれた要件を、1 つずつ短い文にしたもの。検証担当が要件ごとに判定する（07）。
- **操作**：作品の操作（キー・ポインター）と、その操作で起きること。ホストが実際に入力して画面の変化を調べる（03）。

あわせて、制作担当のプロンプトを製品側（`src/core/`）に置き、評価の実行器と実モデルの接続が同じものを使えるようにする。実際に起きた失敗を「症状・原因・直し方」で書いた付録を、制作担当に渡す。

宣言を作品より**先に**書かせるのは、書く前に要件を数え上げさせるためである（制作手順の「標準の流れ 2」を、出力の形で強制する）。計画・仮説の段階は足さない（P3 で費用だけ増えた）。推論の回数は増えない。

## 2. 触るファイル

| 種類 | ファイル | すること |
| --- | --- | --- |
| 追記 | `src/core/spec.ts` | 宣言の正規化（03 で型だけ置いたファイル） |
| 新規 | `src/core/inference.ts` | 1 回の推論の接続口の型 |
| 新規 | `src/core/prompt-maker.ts` | 制作担当の前置き・出力の形・プロンプト・応答の検査・`PromptMaker` |
| 新規 | `docs/maker-pitfalls.md` | 落とし穴の付録（[drafts/maker-pitfalls.md](drafts/maker-pitfalls.md) をそのまま置く） |
| 変える | `src/core/model-port.ts` | `GenerationInput.previousPassed`、`GenerationOutput.spec` |
| 新規 | `tests/unit/spec.test.ts`・`tests/unit/prompt-maker.test.ts` | 試験 |

触らない: `eval/p3/cond-d.ts`（条件 D の前置き・出力の形・プロンプトは P3・general-v1 の記録と対応しているので変えない）、`src/core/maker-skill.ts`、`src/core/recorded-provider.ts`（記録を引く鍵は変えない。足した項目は鍵に入れない）。

## 3. 仕様：宣言の型と正規化（`src/core/spec.ts`）

### 3.1 定数と型

```ts
/** 宣言・台本で使える入力名（KeyboardEvent.code）。Tab と Escape はホストが使うので入れない。 */
export const INPUT_RE = /^(Key[A-Z]|Digit[0-9]|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Space|Enter|ShiftLeft|Backspace)$/;
/** 観測のときの作品の面の寸法（CSS ピクセル）。 */
export const FRAME_W = 480;
export const FRAME_H = 360;

export interface Requirement { id: string; text: string }   // id は "R1", "R2", …（ホストが振る）
export interface Control { kind: "key" | "pointer"; input: string; action: string; always: boolean }
export interface MakerSpec { requirements: Requirement[]; controls: Control[] }
```

### 3.2 `normalizeSpec(raw: unknown): MakerSpec | null`

モデルの出力を、形の合う部分だけ残して `MakerSpec` にする。内容は書き換えない。

1. `raw` が物（配列でない object）でない、または `raw.requirements` が配列でない → `null`。
2. 要件：`raw.requirements` の各要素について、文字列ならその文字列、物なら `text` の項目を取る。前後の空白を除き、空でなければ、300 文字で切って足す。**id は順に `R1`・`R2`… とホストが振る**（モデルが書いた id は使わない）。20 個まで。
3. 要件が 0 個 → `null`。
4. 操作：`raw.controls` が配列なら、各要素（物）について:
   - `action` が空でない文字列でなければ捨てる。100 文字で切る。
   - `kind === "pointer"`：1 つ目だけ残す（2 つ目以降は捨てる）。`input` は `"pointer"` にする。
   - `kind === "key"`：`input` が文字列で `INPUT_RE` に一致し、まだ出ていない入力名なら残す。
   - それ以外の `kind` は捨てる。
   - `always` は、値が `true` のときだけ `true`。それ以外（無い・文字列など）は `false`。
   - 12 個まで。
5. `raw.controls` が配列でなければ、操作は空の配列。

ほかの冊（07）が同じ小さな関数を使うので、次の 3 つも export する。

| 関数 | 仕様 |
| --- | --- |
| `str(v, max)` | `v` が文字列で、前後の空白を除いて空でなければ、`max` 文字で切って返す。そうでなければ `null` |
| `obj(v)` | `v` が物（`null` でも配列でもない object）ならそのまま、そうでなければ `null` |
| `int(v, lo, hi)` | `v` が有限の数で `lo` 以上 `hi` 以下なら、四捨五入して返す。そうでなければ `null` |

## 4. 仕様：推論の接続口（`src/core/inference.ts`）

制作担当も検証担当も、「system・prompt・出力の形を渡して、形の合った JSON の値を受け取る」1 回の推論でできている。その口を 1 つの型にする。

```ts
export interface InferenceRequest {
  purpose: string;          // 記録用の名前。"maker"・"eval-plan"・"eval-judge"
  system: string;
  prompt: string;
  outputSchema: unknown;    // 出力の JSON Schema
  maxOutputChars?: number;
}
export type Validate<T> = (value: unknown) => { ok: true; value: T } | { ok: false; issues: unknown };
export interface InferenceChannel {
  /** 形の違う応答は、理由を付けて出し直す（最大 maxRetries 回）。それでも違えば例外。 */
  complete<T>(req: InferenceRequest, validate: Validate<T>, signal: AbortSignal, maxRetries?: number): Promise<T>;
}
```

既存の `eval/p3/channel.ts` の `FileChannel` は、この型と同じ形の `complete` を持っている（`FileChannel` のコードは変えなくてよい）。09 で、HTTP の実モデルも同じ型で実装する。

## 5. 仕様：制作担当のプロンプト（`src/core/prompt-maker.ts`）

### 5.1 出力の形（`MAKER_OUTPUT_SCHEMA`）

`eval/p3/cond-d.ts` の `ARTWORK_OUTPUT_SCHEMA` に `spec` を足したもの。**項目の順は `title` → `spec` → `entry` → …**（宣言を作品より先に書かせる）。

| 項目 | 必須 | 形 | 説明 |
| --- | --- | --- | --- |
| `title` | ○ | 文字列、1〜80 文字 | 作品の題名 |
| `spec` | ○ | `{ requirements, controls }` | 作品を書く前に決める宣言。entry より先に書く |
| `spec.requirements` | ○ | 文字列の配列、1〜20 個、各 300 文字まで | 依頼に書かれた要件を 1 つずつ短い文にしたもの |
| `spec.controls` | ○ | 配列、12 個まで。要素は `{ kind, input?, action, always }` | 作品の操作の一覧 |
| `spec.controls[].kind` | ○ | `"key"` か `"pointer"` | |
| `spec.controls[].input` | | 文字列 | `kind` が `key` のときだけ。KeyboardEvent.code の名前 |
| `spec.controls[].action` | ○ | 文字列、100 文字まで | その操作で起きること |
| `spec.controls[].always` | ○ | 真偽 | 起動直後から、いつ入力しても画面に変化が出る操作だけ `true` |
| `entry` | ○ | 文字列 | 作品の JavaScript 本文 |
| `dataRef` | | 文字列 | 登録データを使うときだけ |
| `libraries` | | 文字列の配列、4 個まで | 同梱ライブラリを使うときだけ |
| `changes` | ○ | 文字列、2000 文字まで | 変更内容の説明 |
| `unconfirmed` | ○ | 文字列の配列、20 個まで | 依頼のうち確かめられていない点 |
| `reply` | ○ | 文字列、2000 文字まで | 利用者への返答 |

`additionalProperties` は偽（最上位、`spec`、`controls` の要素）。

### 5.2 前置き（`MAKER_PREAMBLE`）

次の文面をそのまま使う（各行を `"\n"` で繋ぐ）。

```
あなたは Canvas の作品（ゲーム・シミュレーション・可視化・3D・物理・HTML の描画）を作る制作担当です。次の制作手順と、要求に含まれる公開された実行契約に従います。
返すのは指定の JSON 一つです。項目は title・spec・entry・changes・unconfirmed・reply（データを使うときだけ dataRef、同梱ライブラリを使うときだけ libraries）。

spec は作品を書く前に決めて、entry より先に書きます。
- spec.requirements：依頼と会話に書かれた要件を、1 つずつ短い文にした配列（20 個まで）。寸法・色・速さ・時間・操作・得点・終了・やり直しを落とさない。基準の作品がある依頼では、「変える点」と「保つ点」の両方を書く。依頼に無い要件を足さない。
- spec.controls：作品の操作の一覧。キーは { "kind": "key", "input": "Space", "action": "ジャンプ", "always": true }、ポインターは { "kind": "pointer", "action": "凡例を押して絞り込む", "always": true } を 1 つだけ。input は KeyboardEvent.code の名前（Space・ArrowLeft・KeyR・Digit1・Enter など）。
- always は「起動直後から、いつ入力しても画面に変化が出る」操作だけ true にします（移動・ジャンプ・発射など）。条件つきの操作（終了後だけ効くやり直し、球が飛んでいる間は受け付けない操作など）は false にします。
ホストは spec を使って作品を確かめます。宣言した操作を実際に入力して画面の変化を調べ、要件ごとに別の担当（検証担当）が観測に基づいて判定します。実装していない要件・操作を spec に書かないこと。確かめられなかった点は unconfirmed に書きます。
```

### 5.3 system（`makerSystem(): string`）

1. `makerSystemPrompt(loadMakerSkill(), MAKER_PREAMBLE)`（既存の `src/core/maker-skill.ts` の関数。前置き ＋ `# 制作手順（…）` ＋ `docs/maker-skill.md` の本文）。
2. `docs/maker-pitfalls.md` があれば、空行を 1 つ挟んで、その全文（前後の空白を除く）を後ろに足す。無ければ足さない。

落とし穴の文書の場所は `MAKER_PITFALLS_PATH`（`resolve(import.meta.dir, "../../docs/maker-pitfalls.md")`）として export する。

### 5.4 プロンプト（`makerPrompt(input: GenerationInput): string`）

`eval/p3/cond-d.ts` の `directPrompt` と同じ並び・同じ見出しにする。違いは「前の候補」の 2 つの節だけ。各節は空行 1 つ（`"\n\n"`）で繋ぐ。

| 順 | 節 | 条件 |
| --- | --- | --- |
| 1 | `## 依頼\n<依頼>` | いつも |
| 2 | `## これまでの会話（古い順）\n<1 行ずつ「利用者: …」「あなた: …」>` | 会話があるとき |
| 3 | `## 基準の作品（保存版）\n<作品>` または `## 基準の作品\nなし（新規）` | いつも |
| 4 | `## 登録データ\n<「- ref: 説明」を 1 行ずつ>` または `## 登録データ\nなし` | いつも |
| 5 | 前の候補（下の 2 通り） | `input.previous` があるとき |
| 6 | `## 公開された実行契約\n<契約の全文>` | いつも |

`<作品>` は、`題名: <題名>`、（あれば）`dataRef: <ref>`、（あれば）`libraries: <"," 区切り>`、続けて ```` ```js ```` で囲んだ本文。

**5 の 2 通り:**

- `input.previousPassed` が真でない（必須の検査に落ちた）：

  ```
  ## 前の候補（試行 <attempt> 回目の前。ホスト観測に通らなかった）
  <作品>

  ## ホスト観測（前の候補）
  - <kind>: <message>
  ```

- `input.previousPassed` が真（必須の検査には通り、検証で指摘があった）：

  ```
  ## 前の候補（試行 <attempt> 回目の前。ホストの必須の検査には通ったが、検証で指摘があった）
  <作品>

  ## 検証の指摘（前の候補）
  「要修正」はすべて直し、「注意」は依頼に照らして必要なら直します。指摘に関係しない部分は変えません。
  - <kind>: <message>
  ```

観測・指摘が 0 件のときは `- （文なし）` の 1 行。

### 5.5 応答の検査（`validateMakerOutput`）

`eval/p3/cond-d.ts` の `validateArtwork` と同じ検査に、`spec` の検査を足す。

- 最上位に、5.1 に無い項目があれば「不明な項目」。必須の項目が無ければ「項目がない」。
- `spec` は、物であり、`requirements` が配列で、**空でない文字列を 1 つ以上含み**、`controls` が配列であること。満たさなければ `spec は { requirements: 空でない文字列の配列（1 つ以上）, controls: 配列 }` を理由にする。
- 通ったら、`GenerationOutput` を返す。**`spec` は受け取った値をそのまま入れる**（正規化は 08 でサービスが行う）。

形が違うと、接続口（`InferenceChannel`）が理由を付けて出し直す。

### 5.6 `PromptMaker`

```ts
export class PromptMaker implements ModelPort {
  readonly label: string;
  constructor(channel: InferenceChannel, o?: { label?: string; system?: string });
  generate(input: GenerationInput, signal: AbortSignal): Promise<GenerationOutput>;
}
```

- `label` の既定は `"prompt-maker"`。`system` の既定は `makerSystem()`。
- `generate` は、`channel.complete({ purpose: "maker", system, prompt: makerPrompt(input), outputSchema: MAKER_OUTPUT_SCHEMA }, validateMakerOutput, signal)` を呼ぶ。例外は `ModelError` に包んで投げ直す（`eval/p3/cond-d.ts` の `DirectModel` と同じ）。

## 6. 仕様：`src/core/model-port.ts` の追加

```ts
export interface GenerationInput {
  // …既存の項目…
  /** 直前の候補がホストの必須の検査に通っていたか（真なら observations は検証の指摘）。省略時は偽。 */
  previousPassed?: boolean;
}
export interface GenerationOutput {
  // …既存の項目…
  /** 制作担当の宣言（要件と操作）。形はホストが正規化する（src/core/spec.ts）。 */
  spec?: unknown;
}
```

どちらも省略できる項目にする。既存の提供者（`RecordedProvider`、`DirectModel`）と既存の試験は変えずに通る。

## 7. 落とし穴の付録（`docs/maker-pitfalls.md`）

[drafts/maker-pitfalls.md](drafts/maker-pitfalls.md) を `docs/maker-pitfalls.md` にそのまま置く。

- 載せるのは、**実際に起きて、原因と直し方を確かめたもの**だけ。出どころは `docs/p2-results.md`・`docs/p3-results.md`・`docs/render-results.md`。
- 追記するときの規則（文書の冒頭にも書いてある）：症状・原因・直し方の 3 点を書く。推測の対策は載せない。人が確かめてから載せる（自動で足さない）。
- `eval/gold/`・`eval/checks/` の中身は写さない。「格子」、観測の版の名前、評価のメタデータ（課題の名前など）は書かない。試験（8.2）が照合する。
- 05 の前にこの冊を実装する場合は、付録の中の `api.canvas3d` と `update`・`draw` に触れた行を外す（契約に無い機能を書かない）。順序どおり 05 が済んでいれば、そのまま置く。

## 8. 試験

### 8.1 `tests/unit/spec.test.ts`

| 入力 | 期待 |
| --- | --- |
| 要件 `[{ id: "x", text: " Space で跳ぶ " }, "R キーでやり直す", { text: "" }, 5]`、操作 7 個（Space・重複の Space・Escape・`always` の無い KeyR・ポインター・2 つ目のポインター・`kind: "touch"`） | 要件は `[{ id: "R1", text: "Space で跳ぶ" }, { id: "R2", text: "R キーでやり直す" }]`。操作は Space（`always: true`）・KeyR（`always: false`）・ポインター（`input: "pointer"`）の 3 個 |
| `null` | `null` |
| `{ requirements: [] }` | `null` |
| `{ requirements: ["a"] }` | `{ requirements: [{ id: "R1", text: "a" }], controls: [] }` |

### 8.2 `tests/unit/prompt-maker.test.ts`

| 試験 | 期待 |
| --- | --- |
| system の並び | `makerSystem()` が `MAKER_PREAMBLE` で始まり、`docs/maker-skill.md` の本文を含み、`# 作品づくりの落とし穴` を含む。`# 制作手順` が落とし穴より前 |
| 書いてはいけないもの | `makerSystem()` と `docs/maker-pitfalls.md` に、`格子`、`host-smoke`、`host-probe`、`heldout`、`general-v1`、`eval/`、`commit` が無い |
| 新規のプロンプト | 入力が「依頼だけ・契約は `CONTRACT-TEXT`」のとき、`"## 依頼\n<依頼>\n\n## 基準の作品\nなし（新規）\n\n## 登録データ\nなし\n\n## 公開された実行契約\nCONTRACT-TEXT"` と一致 |
| 必須の検査に落ちた直し | `## 前の候補（試行 1 回目の前。ホスト観測に通らなかった）` と `## ホスト観測（前の候補）\n- runtime-error: frame: boom` を含む |
| 検証の指摘による直し | `previousPassed: true` のとき、`ホストの必須の検査には通ったが、検証で指摘があった` と `## 検証の指摘（前の候補）\n「要修正」はすべて直し` と `- probe: [要修正] Space が効かない` を含む。`ホスト観測に通らなかった` を含まない |
| 応答の検査 | 正しい応答は通り、`spec` がそのまま、`body` が `{ title, entry }`。`spec` が無い・要件が空・余分な項目がある応答は通らない。`libraries` 付きは `body.libraries` に入る |
| `PromptMaker` | 偽の接続口（渡された要求を覚え、決めた応答を検査に通して返す）で、`purpose` が `"maker"`、`system` が `makerSystem()`。形の違う応答では例外 |

## 9. 完了の確認

```sh
bun run typecheck
bun test tests/unit/spec.test.ts tests/unit/prompt-maker.test.ts tests/unit/maker-skill.test.ts tests/unit/recorded.test.ts
bun run verify
```

## 10. 間違えやすい点

- **`eval/p3/cond-d.ts` を書き換えない。** 新しい制作担当は `src/core/prompt-maker.ts` に別に作る。条件 D は P3・general-v1 の記録と対応している。
- **要件の id をモデルに決めさせない。** ホストが `R1`… と振る。検証担当の判定は、この id で照合する。
- **`always` は厳しめに読む。** `true` でない値はすべて `false`。`true` と宣言された操作に効果が無いと「要修正」になるので、あいまいな値を `true` にしない。
- **宣言を信頼しない。** 宣言は「制作担当がそう言っている」だけである。合否には使わない。ホストが実際に入力して確かめる材料にする。
- **記録を引く鍵に `spec`・`previousPassed` を入れない。** `src/core/recorded-provider.ts` の `inputKey` はそのまま。
