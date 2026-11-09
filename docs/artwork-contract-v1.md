# 作品の実行契約 v1（公開）

制作担当（モデル）に渡す公開契約。版は `canvas-artwork/1`。

## 形式

- 作品は `title`（80 文字以内）と `entry`（単一の JavaScript。UTF-8 で 128 KiB 以内）からなる。任意で、ホストが示した読み取り専用データの `dataRef` を指定できる。
- `entry` は strict mode の関数本体として実行される。`import` 宣言、動的 `import()`、`importScripts`、`eval`・`new Function`、通信（fetch・XHR・WebSocket など）、Worker の生成、保存 API（indexedDB・caches など）は使えない。DOM はない。
- 外部ライブラリ、npm、ビルド手順はない。

## 実行

```js
canvasApp.start((api) => {
  // api.ctx    : CanvasRenderingContext2D 相当（OffscreenCanvas）。座標は CSS ピクセル。DPR の拡大はホストが毎フレーム設定する。
  // api.width, api.height, api.dpr : 現在の表示寸法（CSS ピクセル）。リサイズで更新される。
  // api.data   : 読み取り専用の入力 JSON（凍結済み）。dataRef がなければ null。
  // api.random(): シード固定の乱数 [0, 1)。再現性のため Math.random の代わりに使う。
  // api.status(value): 診断用の通知（JSON、4 KiB まで、毎秒 20 件まで）。合否には使われない。
  return {
    frame(t, dt) {},   // t: 起動からの経過 ms（ホストの時計）, dt: 前フレームからの ms
    input(ev) {},      // { type: "keydown" | "keyup", code, key } または
                       // { type: "pointerdown" | "pointermove" | "pointerup", x, y, button, pointerType }（CSS ピクセル）
    resize(w, h, dpr) {},
  };
});
```

- 時間の進行は `frame` の `t`・`dt` だけに依存させる。`setTimeout`・`setInterval`・`Date.now` はホストの時計とずれるため、ゲームの進行には使わない。
- キー入力は作品がフォーカスを持つ間だけ届く。Tab と Esc はホストが使うため届かない。
- 描画面はフレームをまたいで内容を保持する。毎フレーム全体を描き直すことを推奨する。
- 表示寸法は変わる（枠内・ブラウザ全面・全画面）。レイアウトは `api.width`・`api.height` から毎フレーム計算する。

## ホストの検査

保存には、契約の検査、起動（エラーなしで ready になる）、操作（時間の経過または入力で描画が変わり、画面が単色でない）の合格が必要。依頼に沿うかどうかは自動では確定せず、未確認事項として候補に付ける。
