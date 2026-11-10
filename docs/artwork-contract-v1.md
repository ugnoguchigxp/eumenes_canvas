# 作品の実行契約 v1（公開）

制作担当（モデル）に渡す公開契約。版は `canvas-artwork/1`。

## 形式

- 作品は `title`（80 文字以内）と `entry`（単一の JavaScript。UTF-8 で 128 KiB 以内）からなる。任意で、ホストが示した読み取り専用データの `dataRef` と、ホストが同梱するライブラリの `libraries`（下記）を指定できる。
- `entry` は strict mode の関数本体として実行される。`import` 宣言、動的 `import()`、`importScripts`、`eval`・`new Function`、WebAssembly、通信（fetch・XHR・WebSocket など）、Worker の生成、保存 API（indexedDB・caches など）は使えない。作品は Worker で動くので DOM（`document`・`window`・HTML 要素）はない。HTML は下記の `api.decodeSVG` で画像にして描く。
- npm、CDN、ビルド手順はない。使える外部ライブラリは、ホストが同梱する下記の固定版だけ。

## 同梱ライブラリ（任意）

| id（`libraries` に書く値） | 作品で使う名前 | 内容 |
| --- | --- | --- |
| `"three@0.187.0"` | `THREE` | Three.js r187 の全体と、後処理のアドオン（`EffectComposer`・`RenderPass`・`ShaderPass`・`UnrealBloomPass`・`OutputPass`。`THREE.EffectComposer` のように使う）。そのほかのアドオン（`OrbitControls`・`GLTFLoader` など）は含まない。 |
| `"cannon-es@0.20.0"` | `CANNON` | 剛体の物理エンジン cannon-es 0.20.0（npm `cannon-es@0.20.0`）。 |

- 使うものだけを宣言する。例：`{ "title": "…", "entry": "…", "libraries": ["three@0.187.0", "cannon-es@0.20.0"] }`。宣言したライブラリは、作品の関数本体に引数 `THREE`・`CANNON` として渡る（`canvasApp` と同じ扱い）。`import` や `require` は書かない。
- 宣言せずに `THREE.`・`CANNON.` を使う作品、表にない id・重複は契約の検査で拒否される。引数と同じ名前の `const THREE`・`let CANNON` を作品の中で宣言すると構文エラーになる。
- ライブラリの読み込み（`THREE.TextureLoader`・`FileLoader`・`GLTFLoader` など URL から読むもの）は通信なので動かない。形・色・テクスチャはコードで作る（`CanvasTexture`・`DataTexture`、`api.decodeSVG` の画像）。
- 宣言しない作品の動作は従来と同じ。

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

- `frame` の代わりに `update(t, dt)` と `draw(t)` を返してもよい。`update` は時間が進んだとき（`dt > 0`）だけ呼ばれ、`draw` は画面に出す直前に 1 回だけ呼ばれる。入力・リサイズ・起動のときは `draw` だけが呼ばれる。ホストの観測は時間をまとめて進めるので、`update` は進めた分だけ何度も呼ばれ、`draw` はその最後に 1 回だけ呼ばれる。物理・3D・シェーダーのように描画が重い作品は、この形にする。`frame` と両方を返したときは `frame` だけが使われる。
- 入力には `{ type: "wheel", x, y, deltaX, deltaY }`（ホイール。`deltaX`・`deltaY` は画素の単位、1 描画フレームに 1 回にまとめて届く）もある。ポインターの入力には `id`（指・ポインターごとの番号）が付く。

- `frame(t, dt)` は時間の経過のほか、起動直後・リサイズ・入力（`pointermove` 以外のキー・ポインター入力）のたびに **`dt = 0`** でも呼ばれる（入力の結果をすぐ描くため）。`dt <= 0` のときは、時間に依存する物理・移動・出現・タイマーを進めず、描画だけを行う。例えば重力・速度の積分や「高さが 0 以下なら着地」の判定を `dt = 0` で実行すると、入力で与えた初速が使われる前に着地してしまう。

```js
frame(t, dt) {
  if (dt > 0) update(dt / 1000); // 物理・移動・出現は時間が進んだときだけ
  draw();                        // 描画は毎回
}
```

- 時間の進行は `frame` の `t`・`dt` だけに依存させる。`setTimeout`・`setInterval`・`Date.now` はホストの時計とずれるため、ゲームの進行には使わない。
- キー入力は作品がフォーカスを持つ間だけ届く。Tab と Esc はホストが使うため届かない。
- 描画面はフレームをまたいで内容を保持する。毎フレーム全体を描き直すことを推奨する。
- 表示寸法は変わる（枠内・ブラウザ全面・全画面）。レイアウトは `api.width`・`api.height` から毎フレーム計算する。
- `canvasApp.start` は作品全体で 1 回だけ呼ぶ（2 回目は例外になる）。上の例示は形の説明なので、作品に連結・複製しない。
- キーは `code` と `key` の両方で受ける。例えば Space は `ev.code === "Space" || ev.key === " "`、R は `ev.code === "KeyR" || ev.key === "r" || ev.key === "R"`。

## 3D（Three.js・WebGL）

WebGL は `api.canvas3d` に描く。`api.canvas3d` は 3D 用の面で、2D の面（`api.ctx`）の下に重なって表示される。2D の面に何も描かなければ（または透明のままにすれば）、3D の面がそのまま見える。2D の面に得点などを描けば、3D の上に重なる。

```js
// libraries: ["three@0.187.0"]
canvasApp.start((api) => {
  const renderer = new THREE.WebGLRenderer({ canvas: api.canvas3d, antialias: true });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 6);
  const cube = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial({ color: 0xff3020 }));
  scene.add(cube);
  let angle = 0;
  return {
    resize(w, h, dpr) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false); // 第 3 引数は false（style が無い）
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    update(t, dt) {
      angle += dt / 1000; // update は dt > 0 のときだけ呼ばれる
    },
    draw() {
      cube.rotation.set(angle * 0.7, angle, 0);
      renderer.render(scene, camera);
    },
  };
});
```

- `new THREE.WebGLRenderer({ canvas: api.canvas })` は使えない（2D の面には WebGL の文脈を作れず、例外になる）。
- `resize` は起動直後にも呼ばれる。`setSize` の第 3 引数は `false` にする。`setAnimationLoop`・`requestAnimationFrame` は使わず、`frame`（または `draw`）の中で描く。
- 自分で作った `OffscreenCanvas` に描くこともできる。そのときは、同じ `frame`（または `draw`）の中で `renderer.render` の直後に `api.ctx.drawImage(その面, 0, 0, api.width, api.height)` で 2D の面へ写す（以前からの方法。そのまま使える）。
- 2D の面を 3D の上に重ねるときは、毎回 `api.ctx.clearRect(0, 0, api.width, api.height)` で消してから描く（塗りつぶすと 3D が隠れる）。
- WebGL を使えない環境では文脈の作成が失敗して実行時エラーになる。描画が重い作品は `update`・`draw` の形にする（観測では `draw` は進めた時間の最後に 1 回だけ呼ばれる）。
- 後処理は `THREE.EffectComposer`・`THREE.RenderPass`・`THREE.ShaderPass`・`THREE.UnrealBloomPass`・`THREE.OutputPass` を使える。
- 3D でも、入力はポインター（作品の面の CSS ピクセル）とキーで届く。物体を選ぶときは `THREE.Raycaster` に、`x / api.width * 2 - 1`、`-(y / api.height) * 2 + 1` の正規化座標を渡す。

## 物理（cannon-es）

- `CANNON.World` を作り、`frame` の中で `dt > 0` のときだけ進める。刻みは固定にする：`world.step(1 / 60, dt / 1000, 5)`（固定刻み 1/60 秒、経過時間 `dt`、追いつきは最大 5 刻み）。`dt <= 0` では `step` を呼ばない。`update`・`draw` の形なら、`world.step` は `update` の中で呼ぶ（`update` は `dt > 0` のときだけ呼ばれる）。
- 表示は毎フレーム、物体の `position`・`quaternion` を Three.js のメッシュ（または 2D の図形）に写して描く。物理と描画の単位（メートル・ピクセル）の換算は作品が決める。
- 乱数は `api.random()` を使う（同じ seed・同じ入力列なら同じ結果になるように）。
- 球が床・壁をすり抜けないよう、速い物体には十分な大きさと固定刻みを使う。必要なら刻みを細かくする（例 1/120 秒）。

## HTML の描画（`api.decodeSVG`）

```js
const html = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120">' +
  '<foreignObject width="100%" height="100%">' +
  '<div xmlns="http://www.w3.org/1999/xhtml" style="font:20px sans-serif;color:#fff;background:#2050ff;padding:12px">' +
  '得点 <b>12</b></div></foreignObject></svg>';
let panel = null;
api.decodeSVG(html).then((bitmap) => { panel = bitmap; });   // 復号が済むと frame(t, 0) が呼ばれる
// frame の中: if (panel) api.ctx.drawImage(panel, 16, 16);
```

- `api.decodeSVG(svg)` は SVG の文字列（256 Ki 文字まで）を受け取り、`Promise<ImageBitmap>` を返す。HTML/CSS は `foreignObject` の中に XHTML（`xmlns="http://www.w3.org/1999/xhtml"`、タグは閉じる、`&` は `&amp;`）で書く。ルートの `<svg>` には `width`・`height`（4096 まで）を書く。
- SVG は画像として読まれる。中のスクリプト・イベント属性は動かず、外部の画像・フォント・CSS は読まれない（`<img src>`・`url()` は表示されない）。文字は端末にある書体で描かれる。
- 結果は `api.ctx.drawImage` で描くか、3D では 2D の `OffscreenCanvas` に写して `new THREE.CanvasTexture(その面)` にする。
- 復号は非同期。結果が届くと、ホストは入力と同じく `frame(t, 0)` を呼ぶ。`setup` の中で頼んだ復号は、済むまで（最長 3 秒）起動の完了を待つ。毎秒 30 件・同時 8 件を超える依頼、復号できない SVG は Promise の失敗になる。内容が変わったときだけ作り直す（毎フレーム作り直さない）。
- HTML の要素は操作できない（クリック・文字入力・選択は HTML に届かない）。ボタンや欄は、作品が自分の配置でポインターの座標を判定し、キー入力（`key`）で文字を受ける。IME の入力は扱わない。
- 解像度を上げるには、SVG の `width`・`height` を `api.dpr` 倍にして `viewBox` を CSS ピクセルの寸法にし、`drawImage(bitmap, x, y, 幅, 高さ)` で CSS ピクセルの大きさに描く。

## 観測に写るもの

ホストの表示と観測は、作品の 2 つの面（`api.ctx` に描いた内容と、`api.canvas3d` に描いた内容）を重ねたものを使う。自分で作った `OffscreenCanvas` に描いた WebGL と、`api.decodeSVG` の画像は、どちらかの面に写したときだけ表示・観測に出る。

## 依頼の読み方の既定

依頼に書かれていない点は次のように読み、読んだ内容を未確認事項（`unconfirmed`）に書く。

- **間隔。** 並べる項目の「N px 間隔」が、隣どうしの中心（左端）の距離（ピッチ）か、隙間の幅かが書かれていなければ、中心間の距離（ピッチ）と読む。
- **最初の出現。** 出現の間隔だけが指定され、最初の 1 個の時刻が無ければ、最初の 1 個は起動直後に出し、以降は指定の間隔で出す。
- **3D・物理・HTML の要否。** 3D・カメラ・メッシュ・照明が依頼にあれば `three@0.187.0` を、剛体の衝突・重力・ばねなどの物理の振る舞いが依頼にあれば `cannon-es@0.20.0` を使ってよい（簡単な動きなら自前の計算でもよい）。文章の組版・表・書式付きの文字が依頼にあれば `api.decodeSVG` で HTML を描いてよい。色の指定がある要素は、照明で色が変わらないよう `MeshBasicMaterial` などの照明に左右されない材質で描き、指定どおりの色が画面に出るようにする。どれを使ったかと、照明・陰影で指定の色からずれる部分は未確認事項に書く。
- **終了画面。** 終了（ゲームオーバー）画面は、依頼が許す限り、得点や文字などを残して単色だけにしない。ホストの観測は画面が単色だと不合格にするため、観測中に終了すると候補が保存できない。依頼が画面全体を一色で塗ることだけを求める場合はそれに従い、観測との衝突を未確認事項に書く。

## ホストの検査

保存には、契約の検査、起動（エラーなしで ready になる）、操作（時間の経過または入力で描画が変わり、画面が単色でない）の合格が必要。依頼に沿うかどうかは自動では確定せず、未確認事項として候補に付ける。ホストの観測は、起動・実行時エラー・単色でないか・一定の入力列や時間の経過で描画が変わるかだけを見る（作品の面に写した画素だけを見る）。観測の合格は依頼どおりに動くことの証明ではないので、確かめていない依頼の点は未確認事項に書く。観測の入力の位置や順序に合わせて作品を作らない。
