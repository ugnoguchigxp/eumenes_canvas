# 作品の実行契約 v2：ページ直接モード（公開）

版は `canvas-artwork/2`。**ホストの設定でページ直接モードが有効なときだけ使える。** 無効のホストでは、この版の作品（`runtime` を持つ作品）は契約の検査で拒否される。`runtime` を持たない作品は、これまでどおり [v1](artwork-contract-v1.md) に従う。

ページ直接モードでは、作品は Worker ではなく、DOM のある文書のメインスレッドで動く。`document`・`requestAnimationFrame`・`addEventListener`・Web Audio を使える代わりに、次の制限と危険がある（[境界の実測](page-mode-boundary.md)）。

- WebRTC による外向きの通信は止められない。作品に渡すデータは、外に出てもよいものだけにする（ホストは登録済みの合成データだけを渡す）。
- ホストは Chromium 系のブラウザだけで、この版の作品を開く（WebKit では、無限ループの作品でホストごと固まるため開かない）。

## 形式

- 作品は `title`（80 文字以内）・`entry`（単一の JavaScript、UTF-8 で 128 KiB 以内）・`runtime: "page"` からなる。任意で `dataRef`・`libraries`（v1 と同じ表）を指定できる。
- `entry` は普通のスクリプト（classic script、strict mode ではない）として、ホストの初期化（`canvasHost` の用意）のあとに 1 回だけ実行される。`canvasApp.start` は無い。
- 本文の実行中の例外は起動の失敗になる。観測では、本文のあと最初の 1 回の `requestAnimationFrame` を時刻 0 で呼んでから起動の完了（ready）とするので、そこでの例外も起動の失敗になる。それより後の例外は実行時エラーとしてホストに届く。
- `import` 宣言・動的 `import()`・`importScripts`・`eval`・`new Function`・Worker・serviceWorker・通信（fetch・XHR・WebSocket・EventSource）・保存 API（localStorage・indexedDB・caches・cookie）・`window.open`・遷移は使えない（CSP と sandbox で止まる）。
- 宣言したライブラリは、作品の本文より前に `THREE`・`CANNON` という名前で置かれる。同じ名前を `const`・`let` で宣言すると構文エラーになる。

## 文書と画面

- 文書には、画面いっぱいの `<canvas id="stage">` が 1 つある。大きさ（`width`・`height`）は、起動時と表示寸法の変化のたびに、ホストが CSS ピクセル × DPR に設定する（設定すると内容は消える）。作品は `window.innerWidth`・`window.innerHeight`・`devicePixelRatio` からレイアウトを計算し、`resize` の聞き手で描き直す。
- 作品は文書に要素（`div` など）を足してよい。表示と観測には、文書の画面全体（要素を含む）が写る。
- 外部の画像・フォント・CSS は読めない。画像は `data:`・`blob:` だけ使える。スタイルは `style` 属性と `<style>` を使える。

## ホストから渡るもの

```js
canvasHost.data    // 読み取り専用の入力 JSON（凍結済み）。dataRef がなければ null
canvasHost.seed    // seed（整数）
canvasHost.status(value) // 診断用の通知（JSON、4 KiB まで、毎秒 20 件まで）。合否には使われない
Math.random()      // seed 固定の乱数に差し替え済み
```

## 時間

- 表示（実時間）では、`requestAnimationFrame`・`setTimeout`・`performance.now`・`Date.now` はブラウザのまま動く。
- 観測では、ホストが時計を止めて少しずつ進める。`requestAnimationFrame`・`setTimeout`・`setInterval`・`performance.now`・`Date.now` は仮想の時計に差し替えられ、16ms ごとに呼ばれる。時間の進行は、これらの値だけに依存させる（`new Date()` の引数なしの呼び出しや、`AudioContext.currentTime` は仮想の時計に従わない）。
- v1 の `frame(t, 0)`（時間を進めない描き直し）に当たるものは無い。

## 入力

- キー・ポインター・ホイールは、作品の文書に直接届く（`addEventListener("keydown", …)` など）。Esc はホストが使う（表示モードの退出）ので、作品には渡らない。Tab はフォーカスの移動に使われる。
- キーは `code` と `key` の両方で受ける（v1 と同じ）。

## 例

```js
// runtime: "page"
const c = document.getElementById("stage");
const ctx = c.getContext("2d");
let x = 0;
let last = performance.now();
function loop(now) {
  const dt = Math.min(100, now - last); last = now;
  x = (x + dt * 0.1) % innerWidth;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, innerWidth, innerHeight);
  ctx.fillStyle = "#ff3020"; ctx.fillRect(x, innerHeight / 2 - 20, 40, 40);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
addEventListener("keydown", (e) => { if (e.code === "Space" || e.key === " ") x = 0; });
```

## ホストの検査

保存には、契約の検査、起動（エラーなしで ready になる）、操作（時間の経過または入力で画面が変わり、単色でない）の合格が必要（v1 と同じ）。v1 の dt = 0 の観測は対象外。
