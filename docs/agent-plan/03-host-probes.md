# 03 性質の観測 host-probe/1

## 1. 目的

既存のホスト観測（host-smoke/2）は「どこかで描画が変わる」ことしか見ないので、障害物が動いているだけで通る。P2・P3 のジャンプの課題では、Space を押しても跳べない作品が観測を通り、判定で落ちた。

この冊では、**題材によらない性質**を、同じ seed と手動の時計で調べる観測を足す。推論は使わない。

| 性質 | 調べ方 | 見つかる誤り |
| --- | --- | --- |
| 入力ごとの効果 | 「入力あり」と「入力なし」の 2 回を同じ seed で走らせ、同じ時刻の画面を比べる | 宣言した操作が効かない（ジャンプできない、動かない） |
| dt = 0 の不変性 | 時間を進めない描き直しを 30 回行い、前後の画面を比べる | 入力のたびに物理・タイマーが進む |
| 再現性 | 同じ seed で 2 回走らせ、画面を比べる | `Math.random`・`Date.now` で進行している |
| リサイズ | 幅を 480 → 240 → 480 と変える | 寸法を起動時にしか読まない、リサイズで落ちる |
| 長時間 | 入力なしで 20 秒進める | 時間がたつと落ちる |

結果は**助言**である。保存の必須にしない（README の規則 1）。08 で、重い指摘があれば制作担当に直させる。07 で、検証担当に証拠として渡す。

## 2. 触るファイル

| 種類 | ファイル | すること |
| --- | --- | --- |
| 新規 | `src/core/probes.ts` | 観測の型・定数・規則・文・実行 |
| 新規 | `tests/unit/probe-rules.test.ts` | 規則と文の試験（ブラウザなし） |
| 新規 | `tests/unit/prober.test.ts` | 実ブラウザでの観測の試験 |

この冊では、`probes.ts` が使う型を 2 つ先に置く（06・07・08 で中身を足す）。

| 新規 | 置くもの |
| --- | --- |
| `src/core/spec.ts` | `Requirement`・`Control`・`MakerSpec` の型だけ（06 で正規化の関数を足す） |
| `src/core/review.ts` | `ReviewFinding` の型だけ（08 でほかを足す） |

```ts
// src/core/spec.ts
export interface Requirement { id: string; text: string }
export interface Control { kind: "key" | "pointer"; input: string; action: string; always: boolean }
export interface MakerSpec { requirements: Requirement[]; controls: Control[] }

// src/core/review.ts
export interface ReviewFinding {
  source: "probe" | "evaluator";
  severity: "blocking" | "warning" | "info"; // blocking：直すべき。warning：直したほうがよい。info：参考
  id: string;
  message: string;
}
```

`src/core/types.ts` の `CheckLevel` に `"advisory"` を足す（性質の観測の検査の段階）。

```ts
export type CheckLevel = "contract" | "loaded" | "operated" | "matched" | "advisory";
```

**同時に `src/core/service.ts` の `makeVerification` を直す。** いまは「`matched` 以外はすべて必須」として数えているので、`advisory` を足すと必須に入ってしまう。必須の段階を名前で数える形に変える。

- 変更前：`const required = checks.filter((c) => c.level !== "matched");`
- 変更後：`const required = checks.filter((c) => c.level === "contract" || c.level === "loaded" || c.level === "operated");`

この冊ではまだ `advisory` の検査を検証記録に入れない（08 で入れる）。上の変更で、既存の試験の結果は変わらない。

触らない: `src/core/observer.ts` の `observe`・`OBSERVER_SUITE`。`paintedTargets` は import して使うだけ。

## 3. 仕様

### 3.1 定数

```ts
export const PROBE_SUITE = "host-probe/1";
export const PROBE = {
  seed: 1,
  preMs: 1000,          // 入力の前に進める時間
  holdMs: 200,          // キーを押している時間
  postMs: 400,          // 離したあとに進める時間
  pokeCount: 30,        // 時間を進めない描き直しの回数
  maxKeys: 6,           // 調べるキーの上限
  maxPointers: 4,       // 調べるクリックの上限
  longMs: 20_000,       // 長時間の観測で進める時間
  heavyWallMs: 400,     // 1000ms 進めるのに実時間がこれを超えたら、長時間の観測を省く
  budgetMs: 20_000,     // 観測全体の実時間の上限。超えたら残りを省く
  scriptBudgetMs: 30_000, // 07 の台本全体の実時間の上限
} as const;
const DEFAULT_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "Space"]; // 宣言が無い作品で調べるキー
```

### 3.2 型

```ts
export interface InputEffect {
  id: string;                 // 証拠 id。キーは "P-input-<入力名>"、クリックは "P-pointer-<1 始まりの番号>"
  kind: "key" | "pointer";
  input: string;              // キーは入力名（"Space"）。クリックは "pointer"
  declared: boolean;          // 制作担当が宣言した操作か
  action: string | null;      // 宣言の説明
  always: boolean;            // 宣言の「いつでも効く」
  point: { x: number; y: number } | null; // クリックした点
  during: DiffResult;         // 入力なしの走行との差：押している間（クリックは直後）
  after: DiffResult;          // 同：離して postMs 後
  errors: string[];
}

export interface ProbeReport {
  suite: string;
  environment: string;        // "chromium <版>"
  ms: number;                 // 観測にかかった実時間
  booted: boolean;
  scene: string;              // 起動から preMs の画面の要約（sceneText）
  sceneEnd: string;           // preMs + holdMs + postMs の画面の要約
  motion: DiffResult | null;  // 入力なしで preMs から最後までに変わった画素
  deterministic: boolean | null;
  dtZero: DiffResult | null;
  inputs: InputEffect[];
  resize: { narrowSingleColor: boolean; errors: string[] } | null;
  longRun: { ms: number; singleColor: boolean; errors: string[] } | null;
  errors: string[];           // 入力なしの走行で出た実行時エラー（5 件まで）
  skipped: string[];          // 省いた観測の名前と理由
}

export interface ProbePort {
  readonly suite: string;
  probe(body: ArtworkBody, data: unknown, spec: MakerSpec | null, signal: AbortSignal): Promise<ProbeReport>;
  runScripts(body: ArtworkBody, data: unknown, plan: EvalPlan, signal: AbortSignal): Promise<ScriptResult[]>; // 07 で実装する
  close(): Promise<void>;
}
```

`runScripts` は 07 で実装する。この冊では、`EvalPlan`・`ScriptResult` の型がまだ無いので、`ProbePort` に `runScripts` を書かずに進め、07 で足す。

### 3.3 観測の手順（`PlaywrightProber.probe`）

`PlaywrightProber` は、`PlaywrightObserver` と同じ引数（`hostOrigin`、`issue`）で作る。ブラウザは自分で 1 つ持つ（初めて使うときに `chromium.launch({ args: ["--mute-audio"] })`、`close()` で閉じる）。観測 1 回につき `HarnessSession` を 1 つ開き、最後に必ず閉じる。`signal` が中断されたら `HarnessSession.close()` を呼ぶ（`observer.ts` と同じ形）。

以下、「起動する」は `session.start(body, data, PROBE.seed)` が `ready` を返し、続けて `advance(PROBE.preMs)` すること。`ready` でなければ、その走行は飛ばす。「2 枚撮る」は、`advance(holdMs)` → 撮る → （あれば間の操作）→ `advance(postMs)` → 撮る。

| 順 | 走行 | すること | 記録 |
| --- | --- | --- | --- |
| 1 | 基準（入力なし） | 起動する（かかった実時間を測る）。起動しなければ `booted: false` のまま返す。撮る（`bPre`）。2 枚撮る（`bHold`・`bEnd`）。`poke(pokeCount)`。撮る。`errors()` | `booted: true`、`scene` = `bPre` の要約、`sceneEnd` = `bEnd` の要約、`motion` = `bPre` と `bEnd` の差、`dtZero` = `bEnd` と poke 後の差、`errors` |
| 2 | 再現性 | 起動する。撮る。2 枚撮る | `deterministic` = 3 枚すべてが基準の 3 枚と差 0 |
| 3 | キー（1 つずつ） | 起動する。`keyDown`。2 枚撮る（間の操作は `keyUp`）。`errors()` | `inputs` に 1 件。`during` = `bHold` との差、`after` = `bEnd` との差 |
| 4 | クリック（1 点ずつ） | 起動する。`click(x, y)`。2 枚撮る。`errors()` | `inputs` に 1 件。同上 |
| 5 | リサイズ | 起動する。`setNarrow(true)` → `advance(100)` → 撮る → `setNarrow(false)` → `advance(100)` → `errors()` | `resize.narrowSingleColor` = 狭い画面が単色で、かつ `bPre` が単色でない |
| 6 | 長時間 | 起動する。`advance(longMs - preMs)`。撮る。`errors()` | `longRun` |

細かい規則:

- **調べるキー。** `spec` があれば、宣言のうち `kind === "key"` のものを先頭から `maxKeys` 個（`declared: true`）。`spec` が `null` なら `DEFAULT_KEYS`（`declared: false`、`always: false`、`action: null`）。`spec` があってキーの宣言が 0 個なら、キーは調べない。
- **調べるクリックの点。** `paintedTargets(bPre, PROBE.maxPointers)`（`src/core/observer.ts` の既存の関数。作品が描いた領域の代表点）。`declared: false`。
- **再現性が無いとき。** `deterministic` が `true` でなければ、3 と 4 を行わず、`skipped` に `"入力ごとの比較（再現性が無い）"` を足す。入力の有無による差と、走行ごとの揺れを区別できないため。
- **時間の上限。** 3〜6 の各走行の前に、観測を始めてからの実時間が `budgetMs` を超えていたら、その走行を行わず、`skipped` に足す（`"キー Space（時間の上限）"`・`"クリック 2（時間の上限）"`・`"リサイズ（時間の上限）"`・`"長時間（時間の上限）"`）。
- **重い作品。** 1 の起動（`start` ＋ `advance(preMs)`）にかかった実時間が `heavyWallMs` を超えていたら、6 を行わず、`skipped` に `"長時間（描画が重い）"` を足す。
- 走行ごとのエラーは 3 件まで、基準のエラーは 5 件まで残す。
- 最後に `ms` に実時間を入れる。

### 3.4 指摘の規則（`probeFindings(report): ReviewFinding[]`）

純粋な関数。`booted` が `false` なら空の配列（起動しない作品は必須の検査で落ちる）。それ以外は、次の順に調べて足す。`source` はすべて `"probe"`。

| 条件 | 重さ | id | 文 |
| --- | --- | --- | --- |
| `errors` が 1 件以上 | blocking | `P-errors` | `入力なしで 1600ms 動かす間に実行時エラー：<最初のエラー>` |
| `dtZero.pixels > 0` | warning | `P-dt0` | `時間を進めずに描き直しを 30 回行うと、画面が <N> 画素変わった<範囲>。dt = 0 の呼び出しで状態（物理・移動・タイマー・フレーム数）を進めている可能性がある。入力のたびに dt = 0 で呼ばれるので、入力で速さが変わる・入力直後の動きが消える原因になる` |
| `deterministic === false` | warning | `P-determinism` | `同じ seed・同じ時間で 2 回動かすと画面が違った。Math.random・Date.now・performance.now を進行に使っている可能性がある（乱数は api.random()、時間は frame の t・dt を使う）` |
| 入力ごと：`errors` が 1 件以上 | blocking | 入力の id | `<名前> の入力のあとに実行時エラー：<最初のエラー>` |
| 入力ごと（上に当たらないとき）：キーで、`declared` かつ `always` かつ `deterministic === true` かつ `during.pixels === 0` かつ `after.pixels === 0` | blocking | 入力の id | `宣言した操作「<入力名>：<説明>」（いつでも効く）を、起動から 1000ms の時点で 200ms 押して離したが、押している間も、離して 400ms 後も、押さなかった場合と画面が 1 画素も違わない。入力が効いていない` |
| `resize.errors` が 1 件以上 | blocking | `P-resize` | `表示の幅を 480 から 240 に変えて戻す間に実行時エラー：<最初のエラー>` |
| （上に当たらないとき）`resize.narrowSingleColor` | blocking | `P-resize` | `表示の幅を 240 に狭めると画面が単色になった。レイアウトを api.width・api.height から計算していない可能性がある` |
| `longRun.errors` が 1 件以上 | blocking | `P-long` | `入力なしで 20000ms 動かす間に実行時エラー：<最初のエラー>` |
| （上に当たらないとき）`longRun.singleColor` | info | `P-long` | `入力なしで 20000ms 動かすと画面が単色になった（終了画面が単色の可能性）` |

- 文の中の数値（1600・30・1000・200・400・20000）は `PROBE` の定数から作る。
- `<範囲>` は、差分の外接矩形があれば `（範囲 左上(x,y) 幅w 高さh）`、無ければ空。
- `<名前>` は、キーなら `キー <入力名>`、クリックなら `クリック (x,y)`。
- `<最初のエラー>` は 300 文字まで。
- **クリックで効果が無いことは指摘にしない。** 押しても何も起きない場所は普通にある。
- **宣言の無いキー・条件つきの操作（`always: false`）で効果が無いことも指摘にしない。** 「終了後だけ効くやり直し」は、起動から 1 秒の時点では効かないのが正しい。
- 単色の終了画面は、依頼どおりのことがある（「ゲームオーバーで全面を #400000 に」）。だから info にとどめる。

### 3.5 検査（`probeChecks(report): CheckResult[]`）

検証記録に残す検査。`level` はすべて `"advisory"`。`booted` が `false` なら空。3.4 の指摘のうち **info 以外**が付いた id を「問題あり」とする。

| 検査の id | 出す条件 | 合格の条件 | `detail` |
| --- | --- | --- | --- |
| `probe:no-error` | いつも | `P-errors` の指摘が無い | 指摘の文（300 文字まで） |
| `probe:dt0-stable` | `dtZero` がある | `dtZero.pixels === 0` | `<N> 画素変わった` |
| `probe:deterministic` | `deterministic` が `null` でない | `deterministic === true` | なし |
| `probe:input:<入力名>` | 宣言した入力ごと | その入力の id の指摘が無い | 指摘の文 |
| `probe:resize` | `resize` がある | `P-resize` の指摘が無い | 指摘の文 |
| `probe:long-run` | `longRun` がある | `P-long` の blocking が無い（info は合格） | 指摘の文 |

### 3.6 証拠 id（`probeEvidenceIds(report): string[]`）

07 の検証担当が引用できる id の一覧。`booted` が `false` なら空。順に：`P-scene`、`P-motion`、（`errors` があれば）`P-errors`、（`dtZero` があれば）`P-dt0`、（`deterministic` が `null` でなければ）`P-determinism`、各入力の id、（`resize` があれば）`P-resize`、（`longRun` があれば）`P-long`。

### 3.7 観測の文（`probeText(report): string`）

制作担当・検証担当に渡す文。**各行の先頭が証拠 id** で、`": "` のあとに内容が続く。行の順は 3.6 と同じ。`booted` が `false` なら `（作品が起動しなかったため、性質の観測は無い）` の 1 行。

```
P-scene: 起動から 1000ms（入力なし）の画面。画面 480×360、背景 #000000。要素 2 個：#808080 左上(0,300) 幅480 高さ60 画素28800 / #00ff00 左上(60,280) 幅20 高さ20 画素400
P-motion: 入力なしで 1000ms から 1600ms までに変わった画素は 差なし。1600ms の画面。画面 480×360、背景 #000000。要素 2 個：…
P-dt0: 時間を進めない描き直し 30 回で変わった画素は 差なし
P-determinism: 同じ seed で 2 回動かした画面は一致した
P-input-Space: キー Space（宣言：ジャンプ、いつでも効く）を 1000ms の時点で 200ms 押して離した。入力なしの走行との差：押している間 800 画素（範囲 左上(60,236) 幅20 高さ64）、400ms 後 差なし
P-pointer-1: 描画のある点 (70,290) を 1000ms の時点でクリックした。入力なしの走行との差：直後 差なし、400ms 後 差なし
P-resize: 幅を 240 に狭めて戻した。エラーなし、狭い間も描画あり
P-long: 入力なしで 20000ms 動かした。エラーなし、最後の画面に描画あり
（省いた観測：クリック 3（時間の上限））
```

- 差の書き方：画素が 0 なら `差なし`、それ以外は `<N> 画素<範囲>`。
- キーの行の括弧：宣言ありは `（宣言：<説明>、いつでも効く）` か `（宣言：<説明>、条件つき）`、宣言なしは `（宣言なし）`。
- エラーがある入力の行は、末尾に `。実行時エラー：<最初のエラー>` を足す。
- `P-errors` の行：`P-errors: 入力なしの走行で実行時エラー：<3 件までを " / " で繋ぎ、600 文字まで>`。
- `P-resize` の行の後半：エラーがあれば `実行時エラー：…`、単色なら `狭い間、画面が単色になった`、どちらでもなければ `エラーなし、狭い間も描画あり`。
- `P-long` の行の後半：エラーがあれば `実行時エラー：…`、単色なら `最後の画面は単色`、どちらでもなければ `エラーなし、最後の画面に描画あり`。
- `skipped` が 1 件以上なら、最後に `（省いた観測：<"、" で繋ぐ>）`。
- **固定点（`observer.ts` のクリックの格子）の座標は書かない。** この観測は固定点を使わないので、自然に守られる。「格子」という語も書かない。

## 4. 手順

1. `src/core/spec.ts`・`src/core/review.ts` に 2 節の型を置く。`src/core/types.ts` に `advisory` を足し、`src/core/service.ts` の `makeVerification` を直す。
2. `src/core/probes.ts` に、定数・型・`probeFindings`・`probeChecks`・`probeEvidenceIds`・`probeText` を書く。
3. `tests/unit/probe-rules.test.ts` を書いて通す。
4. `PlaywrightProber` を書く。
5. `tests/unit/prober.test.ts` を書いて通す。

## 5. 試験

### 5.1 `tests/unit/probe-rules.test.ts`（ブラウザなし）

補助関数 `report(上書き)`：問題の無い観測を作る（`booted: true`、`deterministic: true`、`dtZero` は差なし、`inputs` は「Space・宣言あり・いつでも効く・差あり」の 1 件、`resize`・`longRun` は問題なし、`errors` は空）。「差あり」は `{ pixels: 400, box: { x: 60, y: 200, w: 20, h: 100 } }`、「差なし」は `{ pixels: 0, box: null }`。

| 試験 | 入力 | 期待 |
| --- | --- | --- |
| 問題なし | `report()` | 指摘は空。検査の id は順に `probe:no-error`・`probe:dt0-stable`・`probe:deterministic`・`probe:input:Space`・`probe:resize`・`probe:long-run` で、すべて合格・`advisory` |
| 宣言したキーに効果なし | Space の `during`・`after` を差なしに | 指摘は `[blocking, P-input-Space]` の 1 件。文に `Space：ジャンプ` を含む。`probe:input:Space` が不合格 |
| 条件つきの操作 | 上と同じで `always: false` | 指摘は空 |
| 宣言の無いキー | 上と同じで `declared: false` | 指摘は空 |
| 再現性なし | `deterministic: false`、Space は差なし | 指摘は `[warning, P-determinism]` の 1 件だけ |
| まとめて | `dtZero` 差あり、`errors` 1 件、`resize.narrowSingleColor: true`、`longRun.singleColor: true` | 指摘は順に `[blocking, P-errors]`・`[warning, P-dt0]`・`[blocking, P-resize]`・`[info, P-long]`。`probe:long-run` は合格、`probe:dt0-stable` は不合格 |
| 起動しない | `booted: false` | 指摘・検査・証拠 id がすべて空 |
| 文と証拠 id | `report()` にクリック 1 件を足す | 文の各行の先頭（`:` の前）が順に `P-scene`・`P-motion`・`P-dt0`・`P-determinism`・`P-input-Space`・`P-pointer-1`・`P-resize`・`P-long`。文に `キー Space（宣言：ジャンプ、いつでも効く）` を含む。`格子` を含まない |

### 5.2 `tests/unit/prober.test.ts`（実ブラウザ）

`tests/unit/observer.test.ts` と同じ形で書く（`startApp({ hostPort: 4464, previewPort: 4465, devHarness: true })`、`new PlaywrightProber(app.hostOrigin, (b) => app.tokens.issue(b))`、`afterAll` で閉じる、各試験の制限時間は 60 秒）。ポートはほかの試験と重ならない番号を使う。

作品は `tests/e2e/contract-dt0.spec.ts` の `jumper(guard)` と同じもの（Space でジャンプ。`guard` が真なら `dt > 0` のときだけ物理を進める）。宣言は `{ requirements: [{ id: "R1", text: "Space で跳ぶ" }], controls: [{ kind: "key", input: "Space", action: "ジャンプ", always: true }] }`。

| 試験 | 作品 | 期待 |
| --- | --- | --- |
| 正しい作品 | `jumper(true)`＋宣言 | `booted`・`deterministic` が真。`dtZero.pixels` が 0。Space の `during.pixels` が 0 より大きい。`probeFindings` に blocking が無い |
| dt = 0 で進む作品 | `jumper(false)`＋宣言 | Space の `during.pixels` と `after.pixels` が 0（跳べない）。`probeFindings` に `[blocking, P-input-Space]` がある |
| dt = 0 で絵が動く作品 | `frame` のたびに x を 1 進める作品（`dt` を見ない） | `dtZero.pixels` が 0 より大きい。`[warning, P-dt0]` がある |
| 再現性の無い作品 | `Math.random()` で四角の位置を決める作品 | `deterministic` が偽。`skipped` に `入力ごとの比較（再現性が無い）` がある。`inputs` が空 |
| キー入力で落ちる作品 | `input` で例外を投げる作品＋宣言 | `[blocking, P-input-Space]` があり、文に `実行時エラー` を含む |
| 宣言なし | `jumper(true)`、`spec` は `null` | `inputs` のキーが `ArrowLeft`・`ArrowRight`・`ArrowUp`・`Space` の順で、すべて `declared: false` |
| 狭い幅で消える作品 | `api.width >= 400` のときだけ描く作品 | `resize.narrowSingleColor` が真。`[blocking, P-resize]` がある |
| 版 | — | `prober.suite` が `"host-probe/1"` |

## 6. 完了の確認

```sh
bun run typecheck
bun test tests/unit/probe-rules.test.ts
bun test tests/unit/prober.test.ts
bun test tests/unit/service.test.ts tests/unit/observer.test.ts
bun run verify
```

`prober.test.ts` の「正しい作品」と「dt = 0 で進む作品」の 2 つが、この冊の中心である。前者で blocking が出る、または後者で出ないときは、実装を直す（規則を弱めない）。

## 7. 間違えやすい点

- **比べる相手を間違えない。** キーを押している間の画面（`kHold`）は、基準の**同じ時刻**の画面（`bHold`、起動から 1200ms）と比べる。離したあと（`kEnd`）は `bEnd`（1600ms）と比べる。入力の前の画面（`bPre`）と比べると、時間で動く物（障害物）の変化を入力の効果と数えてしまう。
- **走行ごとに起動し直す。** 1 つの走行で複数の入力を試さない。前の入力の影響が残る。
- **`keyDown` のあとに時間を進める。** 押してすぐ離すと、「押している間だけ動く」作品で効果が出ない。
- **エラーは走行ごとに読む。** `HarnessSession.errors()` は、直前の `start` より後のエラーだけを返す。
- **観測の失敗で候補を落とさない。** この観測の中で例外が出ても（ブラウザの不調など）、08 では「検証の失敗」として扱い、候補は提示する。`probe` の中で例外を握りつぶして嘘の結果を返さない（そのまま投げる）。
- **`observer.ts` の固定点を使わない。** クリックの点は `paintedTargets` だけから取る。
