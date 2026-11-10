# 02 観測の土台：画素の道具・時間を進めない描き直し・ハーネスの操作

## 1. 目的

03（性質の観測）と 07（検証担当の台本の実行）が共通で使う部品を先に作る。

1. **画素の道具**：2 枚の画面の差分、画面の要約（色ごとの要素の位置と大きさ）、色のまとまり。
2. **時間を進めない描き直し（poke）**：`frame(t, 0)` を続けて呼ぶ命令。dt = 0 で状態を進めている作品を見つけるために使う。
3. **ハーネスの操作のまとめ（HarnessSession）**：起動・時間を進める・キー・クリック・画面を撮る・エラーを読む。

## 2. 触るファイル

| 種類 | ファイル | すること |
| --- | --- | --- |
| 新規 | `src/core/pixels.ts` | 画素の道具 |
| 新規 | `src/core/harness-session.ts` | ハーネスの操作のまとめ |
| 変える | `src/shared/messages.js` | ホスト→シェルの `poke` を通す |
| 変える | `src/preview/shell.js` | `poke` を作品 Worker に渡す |
| 変える | `src/preview/bootstrap.js` | `poke` を受けて描き直す |
| 変える | `src/host/preview-client.js` | `PreviewController.poke(count)` |
| 変える | `src/host/harness.js` | `harness.poke(count)` |
| 変える | `tests/unit/maker-skill.test.ts` | `frame(0);` の数の期待値を 5 → 6 |
| 新規・追記 | `tests/unit/pixels.test.ts`、`tests/unit/assemble.test.ts`、`tests/unit/bootstrap.test.ts`、`tests/e2e/poke.spec.ts` | 試験 |

触らない: `src/core/observer.ts`（host-smoke/2 の動作と文は変えない）、`eval/lib/env.ts`（評価側の画素の道具は凍結。`src/` から import しない。似た関数を `src/core/pixels.ts` に別に持つ）。

## 3. 仕様：画素の道具（`src/core/pixels.ts`）

### 3.1 型

```ts
export interface Shot { width: number; height: number; data: Uint8Array } // RGBA、1 画素 4 バイト
export interface Box { x: number; y: number; w: number; h: number }
export interface DiffResult { pixels: number; box: Box | null }
export interface SceneItem { color: string; box: Box; area: number }     // color は "#rrggbb"
export interface Scene { width: number; height: number; background: string; items: SceneItem[]; omitted: number }
export interface BlobResult { pixels: number; box: Box | null; cx: number | null; cy: number | null }
```

`pngjs` の `PNG.sync.read(...)` の結果（`width`・`height`・`data`）は、そのまま `Shot` として渡せる（`Buffer` は `Uint8Array` の一種）。

### 3.2 関数

| 関数 | 仕様 |
| --- | --- |
| `rgbHex(r, g, b): string` | `"#rrggbb"`（小文字、各 2 桁）。 |
| `parseHex(h): [number, number, number] \| null` | `/^#([0-9a-fA-F]{6})$/` に一致すれば RGB。しなければ `null`。 |
| `diffShots(a, b): DiffResult` | RGB のどれかが違う画素の数と、その外接矩形。α は比べない。寸法が違えば `{ pixels: a.width * a.height, box: 全面 }`。同じなら `{ pixels: 0, box: null }`。 |
| `dominantColor(s): number` | 最も多い色（`0xRRGGBB`）。全画素を数える。 |
| `isSingleColor(s): boolean` | 全画素の RGB が 1 画素目と同じか。 |
| `blobOf(s, color, tol = 30): BlobResult` | 各チャンネルの差が `tol` 以下の画素の数、外接矩形、重心（小数 1 桁に丸める）。無ければ `{ pixels: 0, box: null, cx: null, cy: null }`。 |
| `describeScene(s, maxItems = 24): Scene` | 下の 3.3。 |
| `sceneText(scene): string` | 下の 3.4。 |

### 3.3 画面の要約（`describeScene`）のアルゴリズム

1. 背景色 = `dominantColor(s)`。
2. 各画素について、背景色との差が**どれかのチャンネルで 24 を超える**なら「前景」。前景の画素には色の鍵を付ける：`((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5)`（各チャンネルの上位 3 ビット）。背景の画素の鍵は `-1`。
3. 鍵が同じで**上下左右に隣り合う**前景の画素を 1 つのまとまりにする（塗りつぶしの探索。再帰ではなく、配列をスタックにして回す）。
4. まとまりごとに、画素数（`area`）、正確な外接矩形（`box`）、代表色（まとまりの中で最も多い**正確な色**。同数なら数値の小さい色）を求める。
5. 画素数が **4 未満**のまとまりは要素にしない（数だけ数える）。
6. 要素を、画素数の大きい順（同数なら `box.y` の小さい順、さらに `box.x` の小さい順）に並べ、先頭から `maxItems` 個を `items` にする。
7. `omitted` = 「`maxItems` を超えて落とした要素の数」＋「5 で落としたまとまりの数」。
8. `background` は背景色の `"#rrggbb"`。

セル（数画素の升目）にまとめる方式は使わない。升目の境界で少数派の色の画素が欠け、面積と外接矩形がずれる（試作で確認済み）。画素単位で行う。640×480 の市松模様（最も細かい場合）でも 1 秒かからない。

### 3.4 画面の要約の文（`sceneText`）

1 行の文にする。要素は `" / "` で繋ぐ。

```
画面 480×360、背景 #000000。要素 3 個：#808080 左上(0,320) 幅480 高さ4 画素1920 / #00ff00 左上(40,288) 幅16 高さ32 画素512 / #ffff00 左上(8,4) 幅8 高さ8 画素64
```

- 先頭は `画面 <幅>×<高さ>、背景 <色>。要素 <items の数> 個`。
- `omitted` が 1 以上なら、続けて `（ほかに小さい要素 <omitted> 個を省略）`。
- 要素が 1 つ以上あれば、続けて `：` と要素の列。要素 1 つは `<色> 左上(<x>,<y>) 幅<w> 高さ<h> 画素<area>`。
- 要素が 0 個なら `：` 以降は書かない。

## 4. 仕様：時間を進めない描き直し（poke）

### 4.1 流れ

```
PreviewController.poke(count)
  → ホスト→シェル { type: "poke", runId, seq, count }      （messages.js が検査）
  → シェル→作品 Worker { type: "poke", seq, count }
  → ブートストラップ：frame(0) を count 回、present()、{ type: "advanced", seq } を返す
  → シェル→ホスト { type: "advanced", runId, seq }           （既存の経路。描画面の反映を待ってから届く）
```

返事は既存の `advanced` を使う。新しい返事の型は作らない。プロトコルの版（`PROTOCOL_VERSION = 1`）は変えない。

### 4.2 各ファイルの変更

**`src/shared/messages.js`**

- `LIMITS` に `maxPokeCount: 120` を足す（`maxAdvanceMs` の次の行）。
- `checkHostToShell` の `switch` に `case "poke":` を足す（`case "advance":` の次）。通す条件：
  - 項目が `type`・`runId`・`seq`・`count` だけ。
  - `runId` が `RUN_ID` に一致。
  - `seq` が整数で 0 以上 2^31 以下。
  - `count` が整数で 1 以上 `LIMITS.maxPokeCount` 以下。

**`src/preview/shell.js`** の `onHostMessage`

- `advance` を渡している行の次に、`m.type === "poke" && m.runId === runId` のとき `toWorker({ type: "poke", seq: m.seq, count: m.count })` を足す。

**`src/preview/bootstrap.js`** のメッセージの処理

- `m.type === "advance"` の分岐の次（`m.type === "input"` の前）に、`m.type === "poke"` の分岐を足す：`frame(0)` を `m.count` 回呼ぶ → `present()` → `post({ type: "advanced", seq: m.seq })`。

**`src/host/preview-client.js`** の `PreviewController`

- `advance(ms)` の次に `poke(count)` を足す。`advance` と同じ形：`seq = ++seqCounter`、`this._wait("advanced:" + seq, 10_000)`、`this.port.postMessage({ type: "poke", runId: this.runId, seq, count })`、待った結果を返す。

**`src/host/harness.js`** の `window.harness`

- `advance: (ms) => ctl.advance(ms),` の次に `poke: (count) => ctl.poke(count),` を足す。

**`tests/unit/maker-skill.test.ts`** の最後の試験

- `expect(boot.match(/frame\(0\);/g)!.length).toBe(5);` を `toBe(6)` に変える。その上のコメントに「観測用の時間を進めない描き直し（poke）」を足す。同じ試験の中の、入力の処理を照合する正規表現は変えない（入力の処理の行は変えていないので、そのまま通る）。

## 5. 仕様：ハーネスの操作のまとめ（`src/core/harness-session.ts`）

Playwright のページで `/harness.html` を開き、作品を 1 つ動かす操作をまとめたクラス。既存の `src/core/observer.ts`（観測）と `eval/lib/env.ts`（評価）がそれぞれ直接書いている操作と同じものを、製品側で再利用できる形にする。**`observer.ts` はこのクラスを使うように書き換えない**（host-smoke/2 の動作を変えないため）。

```ts
export type IssueToken = (body: ArtworkBody) => string;
export interface StartResult { type: string; message?: string } // "ready" | "error" | "violation" | "timeout"
export function playwrightKey(input: string): string;

export class HarnessSession {
  t: number; // 起動から進めた時刻（ms）
  constructor(browser: Browser, hostOrigin: string, issue: IssueToken);
  open(): Promise<void>;
  start(body: ArtworkBody, data: unknown, seed?: number): Promise<StartResult>;
  advance(ms: number): Promise<void>;
  poke(count: number): Promise<void>;
  shot(): Promise<Shot>;
  keyDown(input: string): Promise<void>;
  keyUp(input: string): Promise<void>;
  click(x: number, y: number): Promise<void>;
  drag(from: [number, number], to: [number, number], ms: number): Promise<void>;
  setNarrow(on: boolean): Promise<void>;
  errors(): Promise<string[]>;
  close(): Promise<void>;
}
```

| メソッド | 仕様 |
| --- | --- |
| `open()` | `browser.newContext({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1 })` → 新しいページ → `hostOrigin + "/harness.html"` を開く → `document.title === "ready"` を 10 秒まで待つ。 |
| `start(body, data, seed = 1)` | ① `harness.events.length` を読んで覚える（**この起動より前の通知を読まないための位置**）。② `t = 0`。③ `issue(body)` でトークンを作る。④ `harness.startToken({ token, data, seed, clock: "manual" })` の結果を返す。同じページで何度呼んでもよい（前の作品は止まり、新しい作品が起動する）。 |
| `advance(ms)` | ① 入力が届くのを待つ（下の「待ち」）。② `ms` を **2000 ずつ**に分けて `harness.advance(分けた値)` を呼ぶ。結果の `type` が `"advanced"` でなければ `Error("advance が応答しない: " + type)`。③ `t += ms`。`ms` が 0 のときは①だけ行う。 |
| `poke(count)` | 待ち → `harness.poke(count)`。`"advanced"` でなければ例外。 |
| `shot()` | `page.locator("#frame").screenshot({ scale: "css" })` を `pngjs` で読み、`Shot` で返す。 |
| `keyDown(input)` | `harness.focus()` → `page.keyboard.down(playwrightKey(input))`。 |
| `keyUp(input)` | `page.keyboard.up(playwrightKey(input))`。 |
| `click(x, y)` | `page.locator("#frame").click({ position: { x, y } })`。 |
| `drag(from, to, ms)` | `#frame` の `boundingBox()` を基準に、`mouse.move(from)` → `mouse.down()` → `advance(0)` → 4 回に分けて `mouse.move`（毎回 `advance(Math.round(ms / 4))`）→ `mouse.up()` → `advance(0)`。 |
| `setNarrow(on)` | `harness.setNarrow(on)`（表示の幅を 480 ↔ 240 に変える既存の機能）。 |
| `errors()` | `harness.events` の、`start` で覚えた位置より後ろのうち、`type` が `"error"` か `"violation"` の `message` の配列。 |
| `close()` | コンテキストを閉じる（失敗は無視）。 |

- **待ち**：ページのフレームのうち URL に `/shell.html` を含むものの中で、`requestAnimationFrame` を 2 回待つ（`eval/lib/env.ts` の `settle` と同じ）。入力やリサイズがシェルに届く前に時間を進めないため。
- **`playwrightKey(input)`**：`Key[A-Z]` は小文字の 1 文字（`KeyR` → `r`）、`Digit[0-9]` はその数字（`Digit1` → `1`）、それ以外はそのまま（`Space`・`ArrowLeft`・`Enter`）。`eval/lib/env.ts` の `keyName` と同じ変換にして、評価の判定と同じキーが届くようにする。
- **2000 ずつに分ける理由**：ハーネスの `advance` は 1 回の呼び出しを実時間 10 秒で打ち切る。重い作品（3D・物理）では、作品の時間 1 秒に実時間 1〜2 秒かかる。
- `open()` より前にほかのメソッドを呼んだら `Error("HarnessSession: open() を先に呼ぶ")`。

## 6. 手順

1. `src/core/pixels.ts` を 3 のとおりに作り、`tests/unit/pixels.test.ts` を書いて通す。
2. `poke` を 4.2 の順（messages.js → shell.js → bootstrap.js → preview-client.js → harness.js）に足す。
3. `tests/unit/maker-skill.test.ts` の期待値を変える。
4. `tests/unit/assemble.test.ts` と `tests/unit/bootstrap.test.ts` に試験を足す。
5. `src/core/harness-session.ts` を 5 のとおりに作る。
6. `tests/e2e/poke.spec.ts` を書く。

## 7. 試験

### 7.1 `tests/unit/pixels.test.ts`

補助関数 `img(w, h, bg, rects)`：背景色で塗った RGBA の配列に、矩形を順に塗る。

| 試験 | 入力 | 期待 |
| --- | --- | --- |
| 差分 | 480×360、黒。緑 20×20 を (60,280) に置いた画面と、(60,200) に置いた画面 | 同じ画面どうしは `{ pixels: 0, box: null }`。2 枚の差は `{ pixels: 800, box: { x: 60, y: 200, w: 20, h: 100 } }`。幅の違う画面との差は `pixels` が 172800 |
| 要約 | 黒の上に、灰 480×4 を (0,320)、緑 16×32 を (40,288)、黄 8×8 を (8,4) と (20,4)、白 3×3 を (301,101) | `background` が `#000000`。`items` が順に `[#808080, 0,320,480,4, 1920]`・`[#00ff00, 40,288,16,32, 512]`・`[#ffff00, 8,4,8,8, 64]`・`[#ffff00, 20,4,8,8, 64]`・`[#ffffff, 301,101,3,3, 9]`。文に `#00ff00 左上(40,288) 幅16 高さ32 画素512` が含まれる |
| 接する別の色 | 灰 480×30 を (0,330)、その上に接して緑 16×24 を (30,306) | 要素は 2 個。2 番目が `{ color: "#00ff00", box: { x: 30, y: 306, w: 16, h: 24 }, area: 384 }`（**画素が欠けないこと**） |
| 上限 | 白 6×6 を 40 個、`maxItems = 24` | `items` が 24 個、`omitted` が 16 |
| 小さいまとまり | 赤 1×2 と赤 2×2 | `items` の画素数が `[4]`、`omitted` が 1 |
| 単色 | 何も置かない | `items` が空 |
| 速さ | 640×480 の市松模様 | 1 秒未満。`items` は 0 個（どのまとまりも 1 画素） |
| 色のまとまり | 100×50、背景 (16,16,16)、赤 4×6 を (10,20) | `blobOf(赤)` が `{ pixels: 24, box: { x: 10, y: 20, w: 4, h: 6 }, cx: 11.5, cy: 22.5 }`。青は `{ pixels: 0, box: null, cx: null, cy: null }`。`dominantColor` が `0x101010` |
| 色の文字列 | — | `parseHex("#00ff80")` が `[0, 255, 128]`、`parseHex("red")` が `null` |

### 7.2 `tests/unit/assemble.test.ts` に足す

| 入力 | 期待 |
| --- | --- |
| `{ type: "poke", runId: "r1", seq: 3, count: 30 }` | そのまま通る |
| `count` が 0、121、1.5 | `null` |
| 余分な項目がある、`seq` が無い | `null` |

### 7.3 `tests/unit/bootstrap.test.ts` に足す

- 作品 `let n = 0; canvasApp.start((api) => ({ frame(t, dt) { n++; api.status({ n, t, dt }); } }));`
- `init` → `advance`（ms=32）→ `poke`（seq=2、count=30）。
- 期待：`poke` のあとに増えた `status` が 30 件で、すべて `dt === 0`・`t === 32`。最後に `{ type: "advanced", seq: 2 }`。

### 7.4 `tests/e2e/poke.spec.ts`

`tests/e2e/support/harness.ts` の `openHarness`・`start`・`advance`・`statuses` を使う。

- 作品：`frame` が呼ばれるたびに回数を数え、`api.status({ n, dt })` を出す。画面は毎回同じ絵を描く。
- 起動 → `advance(100)` → `page.evaluate(() => harness.poke(30))`。
- 期待：戻り値の `type` が `"advanced"`。`poke` の前後で `status` の `n` が 30 増え、増えた分の `dt` がすべて 0。
- Chromium と WebKit の両方で通ること。

## 8. 完了の確認

```sh
bun run typecheck
bun test tests/unit/pixels.test.ts tests/unit/assemble.test.ts tests/unit/bootstrap.test.ts tests/unit/maker-skill.test.ts tests/unit/messages.test.ts tests/unit/preview-client.test.ts
bunx playwright test tests/e2e/poke.spec.ts tests/e2e/contract-dt0.spec.ts
bun run verify
```

`HarnessSession` は、この冊では型検査だけで確かめる（使う側の 03 の試験で、実ブラウザで動かす）。

## 9. 間違えやすい点

- **`poke` で時間を進めない。** `frame(0)` を呼ぶだけ。`t` は変わらない。
- **`status` の上限。** シェルは `status` を毎秒 20 件までしか通さない。7.4 の試験で `n` を数えるときは、最後の `status` の `n` の値で比べる（件数で比べない）。
- **`HarnessSession.start` の位置の覚え直し。** 覚えないと、前の起動のエラーを次の起動のエラーとして読んでしまう。
- **`click` はフォーカスも移す。** クリックのあとにキーを送るときも `keyDown` の中の `focus()` はそのまま呼んでよい。
- **α を比べない。** 画面写しの α は常に 255。差分・要約は RGB だけを見る。
