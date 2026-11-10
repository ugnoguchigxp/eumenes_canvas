# 05 描画の制約を外す：直接描画・3D の面・更新と描画の分離・ホイール・後処理

## 1. 目的

04 の表の 1〜6 を外す。作品は Worker の中のままで、隔離（CSP・sandbox・別オリジン・メッセージの検査）は変えない。作品から見た変更は**追加だけ**で、いまの作品は変えずに動く。

| 足すもの | 作品から見た形 | 効果 |
| --- | --- | --- |
| 3D の面 | `api.canvas3d`（WebGL などで描く面。2D の面の下に重なる） | 自前の面を作って毎フレーム写す必要がなくなる |
| 直接描画 | 作品のコードは同じ。ホストが画面の canvas を渡す | 複写 0 回、Worker 自身の時計 |
| 更新と描画の分離 | `frame` の代わりに `update(t, dt)` と `draw(t)` を返す | 観測中の描画が 1 回になる。`dt = 0` で `update` が呼ばれない |
| ホイール | `input` に `{ type: "wheel", x, y, deltaX, deltaY }` | 拡大縮小 |
| ポインターの番号 | ポインターの入力に `id` | 複数の指 |
| 後処理 | `THREE.EffectComposer` ほか 4 つ | bloom などの合成 |

## 2. 触るファイル

| 種類 | ファイル | すること |
| --- | --- | --- |
| 変える | `src/preview/bootstrap.js` | 3D の面、直接描画の分岐、更新と描画の分離、Worker 自身の時計 |
| 変える | `src/preview/shell.js`・`src/preview/shell.css` | 面を 2 枚重ねる、画面の canvas を渡す、ホイール、ポインターの番号 |
| 変える | `src/shared/messages.js` | `start` に `direct` を通す |
| 変える | `src/host/preview-client.js`・`src/host/harness.js`・`src/host/app.js` | `direct` を渡す |
| 変える | `src/server/app.ts`・`src/server/canvas-app.ts`・`src/server/main.ts` | 設定 `directRender`・`observerArgs` |
| 変える | `src/core/observer.ts`・`src/core/probes.ts` | ブラウザの起動引数を受け取る（動作は変えない） |
| 変える | `src/preview/libs/three.js` | 後処理のアドオンを同じ束に入れる |
| 変える | `docs/artwork-contract-v1.md`・`docs/maker-skill.md` | 新しい形を書く。「重くしすぎない」を外す |
| 変える | `tests/unit/maker-skill.test.ts`・`tests/unit/render-libraries.test.ts` | 期待値の更新（下に書いた箇所だけ） |
| 追記・新規 | `tests/unit/bootstrap.test.ts`、`tests/unit/assemble.test.ts`、`tests/e2e/direct-render.spec.ts` | 試験 |

触らない: `src/contract/artwork.ts`（契約の版・digest・上限は変えない）、`src/server/preview.ts` の CSP、`examples/render/`・`fixtures/`（既存の作品は書き換えない）。

## 3. 仕様：作品 Worker（`src/preview/bootstrap.js`）

### 3.1 状態を足す

`var canvas = null;` の近くに、次の変数を足す。

| 変数 | 初期値 | 意味 |
| --- | --- | --- |
| `canvas3d` | `null` | 3D の面。複写方式では、作品が初めて `api.canvas3d` を読んだときに作る |
| `used3d` | `false` | 作品が `api.canvas3d` を読んだか |
| `direct` | `false` | 画面の canvas を直接受け取ったか |
| `split` | `false` | 作品が `frame` の代わりに `update`・`draw` を返したか |
| `needDraw` | `false` | `draw` を呼ぶ必要があるか |
| `selfClock` | `false` | Worker 自身の `requestAnimationFrame` で進めているか |

### 3.2 起動（`init`）

`init` のメッセージに、次の項目が**あってもなくても**動くようにする（シェルからのメッセージなので `messages.js` の検査は通らない。シェルは信頼する側）。

| 項目 | 意味 |
| --- | --- |
| `canvas2d` | 画面の 2D の canvas を渡したもの（`OffscreenCanvas`） |
| `canvas3d` | 画面の 3D の canvas を渡したもの |
| `selfClock` | `true` なら、Worker 自身の時計で進めてよい |

1. `direct = !!(m.canvas2d && m.canvas3d)`。
2. `direct` が真：`canvas = m.canvas2d`、`canvas3d = m.canvas3d`。表示用の面（`presentCanvas`・`presentCtx`）は**作らない**。
3. `direct` が偽：今と同じ（`canvas`・`presentCanvas` を `new OffscreenCanvas(1, 1)` で作る）。
4. どちらの場合も `ctx = canvas.getContext("2d")`。
5. `api` を作ったあと（`Object.freeze(api.decodeSVG);` の次）に、`api.canvas3d` を**読み取りの口**として足す：`Object.defineProperty(api, "canvas3d", { enumerable: false, get: … })`。読まれたら `used3d = true` にし、`canvas3d` が `null` なら `new OffscreenCanvas(canvas.width, canvas.height)` を作り、`canvas3d` を返す。何度読んでも同じ面を返す。
6. `setupFn(api)` が返した `handlers` を受け取った直後に、`split` を決める：**`handlers.frame` が関数でなく、かつ `handlers.update` か `handlers.draw` が関数**のとき真。`frame` があれば、`update`・`draw` があっても `frame` の形として扱う。
7. `init` の処理の最後（`return;` の直前）に、Worker 自身の時計を始める：`direct` が真、かつ `m.selfClock === true`、かつ `typeof self.requestAnimationFrame === "function"` のとき。
   - `selfClock = true`。
   - `self.requestAnimationFrame` に渡す関数は、`now` を受け取り、前回の `now` との差を `dt` とする（最初は 0、0 以上 100 以下に丸める。`tick` の処理と同じ）。`frame(dt)` → `present()` → 次の `requestAnimationFrame`。

### 3.3 寸法（`applySize`）

- `canvas.width`・`canvas.height` を設定するのは今と同じ。
- `presentCanvas` があるときだけ、その寸法を合わせる。
- `canvas3d` があるとき、その寸法を `canvas` と同じにする（作品の `resize` を呼ぶ**前**に合わせる。作品は `resize` の中で変えてよい）。

### 3.4 時間を進める（内部の関数 `frame(dt)`）

名前は `frame` のまま変えない（`tests/unit/maker-skill.test.ts` が、入力の処理の行を文字列で照合している）。

- `t += dt`。
- `split` が真：`dt > 0` のときだけ `call("update", [t, dt])`。`needDraw = true`。
- `split` が偽：今と同じ（`ctx.setTransform(…)` → `call("frame", [t, dt])`）。
- `dirty = true`。

### 3.5 表示へ出す（内部の関数 `present()`）

1. `dirty` が偽なら何もしない。`dirty = false`。
2. `split` かつ `needDraw` なら：`needDraw = false` → `ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0)` → `call("draw", [t])`。
3. `direct` が真なら、ここで終わり（画面の canvas に描いているので、何も送らない）。
4. `direct` が偽：`presentCtx` を初期化して消す（今と同じ）→ **`used3d` が真で `canvas3d` があれば、`presentCtx.drawImage(canvas3d, 0, 0, presentCanvas.width, presentCanvas.height)`** → `presentCtx.drawImage(canvas, 0, 0)` → 画像にして送る（今と同じ）。

こうすると、`frame(0); present();` と書いてある既存の呼び出し（起動・入力・リサイズ・復号の完了）は、文字を変えずに、`update`・`draw` の形でも正しく動く（`update` は呼ばれず、`draw` が 1 回呼ばれる）。時間を進める命令（`advance`）は、`frame(16)` を繰り返したあと `present()` を 1 回呼ぶので、`update` が 63 回、`draw` が 1 回になる。

### 3.6 `tick`

`m.type === "tick"` の処理の先頭に、`selfClock` が真なら何もしないで戻る、を足す。

## 4. 仕様：シェル（`src/preview/shell.js`・`shell.css`）

### 4.1 面を重ねる

`shell.css` を次のようにする（面を左上に重ねる）。

```css
#stage { width: 100%; height: 100%; position: relative; }
canvas { display: block; position: absolute; left: 0; top: 0; width: 100%; height: 100%; outline: none; touch-action: none; }
```

`start(m)` の中:

1. 直接描画にするかを決める：`const direct = m.direct === true && m.clock === "raf" && typeof HTMLCanvasElement.prototype.transferControlToOffscreen === "function";`
2. `direct` が真のときだけ、3D の canvas（`canvas3d`、モジュールの変数に持つ）を作り、**先に** `stage` に足す（下の層）。
3. 2D の canvas（既存の `canvas`）を作って足す（上の層。`tabIndex = 0`、入力とフォーカスはこちらで受ける）。
4. `direct` が偽：今と同じ（`canvas.getContext("bitmaprenderer")` で受け取り、`frame` のメッセージで差し替える）。
5. `direct` が真：
   - `bitmaprenderer` は作らない（渡した canvas には文脈を作れない）。`frame` のメッセージが来ても無視する。
   - `const off2d = canvas.transferControlToOffscreen(); const off3d = canvas3d.transferControlToOffscreen();`
   - `init` を `toWorker({ type: "init", width, height, dpr, data, seed, canvas2d: off2d, canvas3d: off3d, selfClock: true }, [off2d, off3d])` で送る（第 2 引数が渡す物の一覧）。
   - **渡したあと、シェルから `canvas.width`・`canvas.height` を設定しない**（例外になる）。寸法は Worker が設定する。
6. `stopWorker` で、`canvas3d` があれば取り除いて `null` にする。

`direct` が真でも、シェルの `requestAnimationFrame` の輪はそのまま回す（`pointermove` とホイールをまとめて送るため）。`tick` も送り続けてよい（Worker 側が無視する）。

### 4.2 ホイール

- `canvas` に `wheel` の聞き手を足す（`{ passive: false }`）。`e.preventDefault()` する。
- 1 描画フレームに 1 回へまとめる（`pointermove` と同じ）。まとめ方：`deltaX`・`deltaY` は足し合わせ、`x`・`y` は最後の値。
- `e.deltaMode` が 1（行）なら 16 倍、2（ページ）なら 400 倍して、画素の単位にそろえる。
- 送る形：`{ type: "wheel", x, y, deltaX, deltaY }`（`x`・`y` は作品の面の CSS ピクセル）。
- `flushMove()` の中で、たまっていれば `toWorker({ type: "input", ev })` で送って空にする。

### 4.3 ポインターの番号

`pointerEv(type, e)` が返す物に `id: e.pointerId` を足す。

## 5. 仕様：ホストから `direct` を渡す

| ファイル | 変更 |
| --- | --- |
| `src/shared/messages.js` | `checkHostToShell` の `start`：許す項目に `direct` を足す。`direct` があるときは `true` か `false` でなければ通さない。 |
| `src/host/preview-client.js` | `start({ token, data, seed, clock, direct = false })`。送るメッセージには、`direct` が真のときだけ `direct: true` を入れる（偽のときは項目を入れない。既存のメッセージと同じ形を保つ）。`lastStart` にも覚える。 |
| `src/host/harness.js` | `start`・`startToken` が `direct` を受け取り、`ctl.start` に渡す（既定は偽）。 |
| `src/server/app.ts` | `AppOptions` に `directRender?: boolean`。`/api/config` の返事に `directRender: !!opts.directRender` を足す。 |
| `src/server/canvas-app.ts` | `CanvasAppOptions` に `directRender?: boolean` を足し、`startApp` に渡す。 |
| `src/server/main.ts` | `CanvasConfig` に `directRender?: boolean` と `observerArgs?: string[]`。`runFromConfig` で渡す。 |
| `src/host/app.js` | 下の規則で `direct` を決め、`ctl.start({ …, direct })` に渡す。 |

`app.js` の規則（`CLOCK` を決めている行の近くに書く）:

- `const WEBKIT_ONLY = /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg\//.test(navigator.userAgent);`
- `const DIRECT = CLOCK === "raf" && cfg.directRender === true && !WEBKIT_ONLY;`

既定の `canvas.config.json` には、試験が通ったあとで `"directRender": true` を足す（7 節の手順 8）。項目が無いときは偽（今と同じ動作）。

## 6. 仕様：そのほか

### 6.1 後処理のアドオン（`src/preview/libs/three.js`）

本体と同じ束に入れ、`THREE` の名前で渡す。

```js
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
__canvasLibs.three = Object.assign({}, THREE, { EffectComposer, RenderPass, ShaderPass, UnrealBloomPass, OutputPass });
```

- 束は 1 つで、Three.js の本体は 1 つだけ入る（試作で確認：755,502 → 774,505 バイト、`WebGLRenderer` の定義は 1 つ）。
- id は `three@0.187.0` のまま。中身が増えるだけなので、保存済みの作品はそのまま動く。
- `OrbitControls` などは DOM の要素に聞き手を付けるので、Worker では動かない。入れない。

### 6.2 観測のブラウザの起動引数

- `PlaywrightObserver` と `PlaywrightProber` の作り方に、省略できる 3 番目の引数 `launchArgs: string[] = []` を足す。起動は `chromium.launch({ args: ["--mute-audio", ...launchArgs] })`。
- `src/server/main.ts` の `runFromConfig` で、`cfg.observerArgs ?? []` を渡す。
- 既定は空（今と同じ）。GPU を使う引数は環境ごとに違うので、この計画では決めない。使うときは、その環境で観測の試験が通ることを確かめてから設定に書く。

### 6.3 契約の文書（`docs/artwork-contract-v1.md`）

版は `canvas-artwork/1` のまま。次の 5 か所を変える。

**(a) 「実行」の節。** コードの例の `return { … }` の説明に、次を足す。

> `frame` の代わりに `update(t, dt)` と `draw(t)` を返してもよい。`update` は時間が進んだとき（`dt > 0`）だけ呼ばれ、`draw` は画面に出す直前に 1 回だけ呼ばれる。入力・リサイズ・起動のときは `draw` だけが呼ばれる。ホストの観測は時間をまとめて進めるので、`update` は進めた分だけ何度も呼ばれ、`draw` はその最後に 1 回だけ呼ばれる。物理・3D・シェーダーのように描画が重い作品は、この形にする。`frame` と両方を返したときは `frame` だけが使われる。

入力の説明に、次を足す。

> `{ type: "wheel", x, y, deltaX, deltaY }`（ホイール。`deltaX`・`deltaY` は画素の単位、1 描画フレームに 1 回にまとめて届く）。ポインターの入力には `id`（指・ポインターごとの番号）が付く。

**(b) 「3D（Three.js・WebGL）」の節。** 冒頭の段落と例を、`api.canvas3d` を使う形に書き換える。

> WebGL は `api.canvas3d` に描く。`api.canvas3d` は 3D 用の面で、2D の面（`api.ctx`）の下に重なって表示される。2D の面に何も描かなければ（または透明のままにすれば）、3D の面がそのまま見える。2D の面に得点などを描けば、3D の上に重なる。

例は、今の例の `const gl = new OffscreenCanvas(1, 1);` と `new THREE.WebGLRenderer({ canvas: gl, … })` を `new THREE.WebGLRenderer({ canvas: api.canvas3d, antialias: true })` に変え、`frame` の最後の `api.ctx.drawImage(gl, …)` の行を消す。`frame` は `update(t, dt)`（角度を進める）と `draw()`（`renderer.render`）に分ける。

箇条書きを次のように直す。

- 「`new THREE.WebGLRenderer({ canvas: api.canvas })` は使えない」は残す（`api.canvas` は 2D の面）。
- 「`drawImage` で写すのは `renderer.render` の直後」の項目を、次に置き換える：「自分で作った `OffscreenCanvas` に描くこともできる。そのときは、同じ `frame`（または `draw`）の中で `renderer.render` の直後に `api.ctx.drawImage(その面, 0, 0, api.width, api.height)` で 2D の面へ写す（以前からの方法。そのまま使える）。」
- 「2D の面を 3D の上に重ねるときは、毎回 `api.ctx.clearRect(0, 0, api.width, api.height)` で消してから描く（塗りつぶすと 3D が隠れる）。」を足す。
- **「描画はソフトウェア（GPU なし）の場合があるので、1 フレームの計算を重くしすぎない（全画面のシェーダーは解像度を下げて描き、`drawImage` で引き伸ばしてよい）」の文を消す。** 代わりに：「描画が重い作品は `update`・`draw` の形にする（観測では `draw` は進めた時間の最後に 1 回だけ呼ばれる）。」
- 後処理を足す：「後処理は `THREE.EffectComposer`・`THREE.RenderPass`・`THREE.ShaderPass`・`THREE.UnrealBloomPass`・`THREE.OutputPass` を使える。」

**(c) 「同梱ライブラリ」の表。** `three@0.187.0` の内容の欄を「Three.js r187 の全体と、後処理のアドオン（`EffectComposer`・`RenderPass`・`ShaderPass`・`UnrealBloomPass`・`OutputPass`。`THREE.EffectComposer` のように使う）。そのほかのアドオン（`OrbitControls`・`GLTFLoader` など）は含まない。」に変える。

**(d) 「観測に写るもの」の節。** 「ホストの表示と観測は、作品の 2 つの面（`api.ctx` に描いた内容と、`api.canvas3d` に描いた内容）を重ねたものを使う。自分で作った `OffscreenCanvas` に描いた WebGL と、`api.decodeSVG` の画像は、どちらかの面に写したときだけ表示・観測に出る。」に変える。

**(e) 「物理（cannon-es）」の節。** 最初の項目に「`update`・`draw` の形なら、`world.step` は `update` の中で呼ぶ（`update` は `dt > 0` のときだけ呼ばれる）。」を足す。

`tests/unit/maker-skill.test.ts` は契約に特定の文字列があることを確かめている（`**\`dt = 0\`** でも呼ばれる`、`if (dt > 0) update` など）。**それらの文は消さない。** `frame` の形の説明はそのまま残し、上の文を足す。

### 6.4 制作手順（`docs/maker-skill.md`）

- 必須原則 10「すべての画素を作品の面に集める」を書き換える：「表示と観測に出るのは、`api.ctx`（2D の面）と `api.canvas3d`（3D の面）に描いた内容だけ。WebGL は `api.canvas3d` に描く。自分で作った `OffscreenCanvas` に描いたときは、毎フレーム `api.ctx.drawImage` で写す。`api.decodeSVG` の画像も `drawImage` で描く。」
- 必須原則 1 の末尾に足す：「`frame` の代わりに `update(t, dt)` と `draw(t)` を返すと、`update` は `dt > 0` のときだけ呼ばれるので、この誤りが起きない。物理・3D・シェーダーの作品はこの形にする。」
- 標準の流れ 4 の「`frame` は『`dt > 0` なら更新…、毎回描画』の形にする」に、「または `update`・`draw` に分ける」を足す。
- 完成条件の「WebGL の描画と HTML の画像が、毎フレーム作品の面（`api.ctx`）に写されている」を「WebGL の描画が `api.canvas3d`（または `api.ctx` への写し）に、HTML の画像が `api.ctx` に出ている」に変える。

`tests/unit/maker-skill.test.ts` が照合している文字列（「`dt <= 0` では物理を進めない」など）は残す。

## 7. 手順

1. `bootstrap.js` を 3 のとおりに変え、`tests/unit/bootstrap.test.ts` に 8.1 の試験を足して通す。
2. `shell.css`・`shell.js` を 4 のとおりに変える。
3. `messages.js`・`preview-client.js`・`harness.js` に `direct` を通す（5）。`tests/unit/assemble.test.ts` に 8.2 を足す。
4. `app.ts`・`canvas-app.ts`・`main.ts`・`app.js` に設定を通す（5）。
5. `libs/three.js` を 6.1 のとおりに変える。`tests/unit/render-libraries.test.ts` の、大きさを確かめている箇所があれば更新する。
6. `observer.ts`・`probes.ts` に起動引数を通す（6.2）。
7. 契約と制作手順の文書を変える（6.3・6.4）。
8. `tests/e2e/direct-render.spec.ts` を書いて通す。通ったら、`canvas.config.json` に `"directRender": true` を足す。
9. 利用者に、検証ホストの再起動を頼む（設定を読み直すため）。再起動は利用者が行う。

## 8. 試験

### 8.1 `tests/unit/bootstrap.test.ts` に足す（偽の Worker 環境）

偽の `self` に `requestAnimationFrame` を付けられるようにする（渡された関数を配列に積み、試験から `flushRaf(now)` で呼ぶ）。

| 試験 | すること | 期待 |
| --- | --- | --- |
| `update`・`draw` | `update` と `draw` のそれぞれで `api.status` を出す作品。`init` → `advance(1000)` → キーの `input` → `poke(30)` | `status` の並びが、起動で `d`、`advance` で `u` が 63 回と `d` が 1 回、入力で `d` が 1 回、`poke` で `d` が 1 回。`u` の `dt` はすべて 0 より大きい |
| `frame` が優先 | `frame`・`update`・`draw` を全部返す作品。`init` → `advance(16)` | 呼ばれるのは `frame` だけ（2 回） |
| 複写方式の 3D の面 | 起動時に `api.canvas3d` を読む作品。`dpr: 2` で `init` | 何度読んでも同じ面。寸法は 960×720。`frame` のメッセージ（画像）が送られる |
| 3D の面を使わない作品 | `api.canvas3d` を読まない作品 | `frame` のメッセージが送られる（今と同じ） |
| 直接描画 | `init` に偽の `canvas2d`・`canvas3d` と `selfClock: true` を付ける。偽の `self` に `requestAnimationFrame` あり | `posted` の型が `status`・`ready` だけ（`frame` が無い）。`api.canvas`・`api.canvas3d` が渡した面。両方の寸法が 480×360。`flushRaf(1000)` → `flushRaf(1016)` で `[t, dt]` が `[0,0]`・`[16,16]` と進む。`tick` を送っても進まない。`resize`（幅 240）で両方の面の幅が 240 |
| 直接描画で時計が無い | 同じ `init`、偽の `self` に `requestAnimationFrame` なし | `tick` で進む |

### 8.2 `tests/unit/assemble.test.ts` に足す

| 入力 | 期待 |
| --- | --- |
| `start` に `direct: true` | 通る |
| `start` に `direct: "yes"` | `null` |
| `direct` の無い `start` | 今と同じく通る |

### 8.3 `tests/e2e/direct-render.spec.ts`

`tests/e2e/support/harness.ts` と `tests/e2e/support/pixels.ts` を使う。`start` の補助関数に `direct` を渡せるようにする（既定は渡さない）。

| 試験 | 対象 | すること | 期待 |
| --- | --- | --- | --- |
| 複写方式で 3D の面が写る | Chromium | 作品：`api.canvas3d` に WebGL で全面を赤（`gl.clearColor(1,0,0,1); gl.clear(…)`）、`api.ctx` は `clearRect` してから左上に白 20×20。手動の時計で起動 → `advance(100)` → 画面を撮る | 左上の 20×20 が白、ほかが赤 |
| 3D の面を写し忘れても単色にならない | Chromium | 上の作品から `api.ctx` の描画を消す | 全面が赤（表示に出る） |
| 直接描画 | Chromium | 同じ作品を `clock: "raf"`・`direct: true` で起動。シェルのフレームの中の canvas の数を数える。1 秒待って画面を撮る | canvas が 2 枚。左上が白、ほかが赤 |
| 直接描画でも入力が届く | Chromium | クリックで色が変わる作品を直接描画で起動し、クリックする | 色が変わる |
| `update`・`draw` | Chromium・WebKit | `update` の回数と `draw` の回数を `api.status` で出す作品。手動の時計で `advance(1000)` | `update` が 63 回増え、`draw` は 1 回増える |
| ホイール | Chromium・WebKit | `input` で受けた `wheel` の `deltaY` を `api.status` で出す作品。`page.mouse.wheel(0, 120)` | `deltaY` が 0 より大きい `status` が届く |
| 後処理 | Chromium | `libraries: ["three@0.187.0"]` で、`typeof THREE.EffectComposer`・`typeof THREE.UnrealBloomPass` を `api.status` で出す作品 | どちらも `"function"` |
| WebKit は複写のまま | WebKit | 2D だけの作品を `clock: "raf"`、`direct` を渡さずに起動 | 今と同じく表示に出る |

WebGL を使う試験は、既存の `tests/e2e/render.spec.ts` と同じく WebKit では飛ばす。

### 8.4 既存の試験

- `tests/unit/maker-skill.test.ts`：契約と制作手順に残すべき文字列の照合が、文書の変更後も通ること。観測の固定点・評価のメタデータを書いていないことの照合も通ること。
- `tests/e2e/render.spec.ts`・`tests/e2e/demo-games.spec.ts`：既存の作品が変わらず動くこと。

## 9. 完了の確認

```sh
bun run typecheck
bun test tests/unit/bootstrap.test.ts tests/unit/assemble.test.ts tests/unit/maker-skill.test.ts tests/unit/messages.test.ts tests/unit/preview-client.test.ts tests/unit/render-libraries.test.ts
bunx playwright test tests/e2e/direct-render.spec.ts
bunx playwright test tests/e2e/render.spec.ts tests/e2e/p0-threats.spec.ts tests/e2e/p1-display.spec.ts
bun run verify
```

結果を `docs/render-results.md` に追記する：直接描画の有無でのデモの 1 フレームの所要時間（測れる範囲で）、束の大きさ、試験の件数、WebKit で直接描画を使っていないこと。

## 10. うまくいかないときの決め方

ブラウザでの動作は、この設計の時点では確かめていない。次のときは、ここに書いた側へ倒す。

| 起きたこと | すること |
| --- | --- |
| Chromium の直接描画で、画面に何も出ない・古い絵のまま | `canvas.config.json` に `directRender` を足さない（既定の偽のまま）。複写方式の 3D の面・`update`/`draw`・ホイール・後処理はそのまま残す。起きたことを `docs/render-results.md` に書く |
| 直接描画で、表示モード（枠内・全面・全画面）を変えると絵が崩れる | Worker の `applySize` が両方の面の寸法を設定しているかを確かめる。直らなければ上と同じ |
| 複写方式で、3D の面を重ねると色が変わる・透ける | 3D の面を写すときは `presentCtx.drawImage(canvas3d, 0, 0, 幅, 高さ)` を、2D の面より**先**に描いているかを確かめる |
| `transferControlToOffscreen` のあとで例外 | シェルが渡した canvas の `width`・`height` を触っていないか、`bitmaprenderer` を作っていないかを確かめる |
| `p0-threats.spec.ts` が落ちる | この冊の変更で隔離は変えていないはず。落ちたら変更を戻して原因を調べる。**試験を弱めない** |

## 11. 間違えやすい点

- **2D の面と 3D の面は別の canvas。** 1 枚の canvas に 2D と WebGL の両方の文脈は作れない。だから 2 枚重ねる。
- **`api.canvas3d` は読まれたときに作る（複写方式）。** 起動時に必ず作ると、3D を使わない作品の表示が毎フレーム 1 回余分に複写される。
- **`frame` の形の作品の動作を変えない。** 入力のたびに `frame(t, 0)` が呼ばれるのは今のまま。変わるのは `update`・`draw` を返した作品だけ。
- **手動の時計では直接描画にしない。** 観測・評価は複写方式で撮る。シェルの判定（`m.clock === "raf"`）を外さない。
- **直接描画の判定はホストが渡す。** シェルは `m.direct === true` のときだけ直接描画にする。シェルが自分で「できそうだから」と直接描画にしない（WebKit で表示に出ないことがある）。
