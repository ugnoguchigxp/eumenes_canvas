# 04 描画の制約の棚卸しと方針

この冊は読むだけ。実装は 05（隔離を変えずに外せるもの）と 10（隔離に関わるもの）で行う。

## 1. きっかけ

「同じ推論力でも、Canvas 側には実行環境による足かせがある。素の Web ページ（メインスレッドから画面の canvas に直接 WebGL で描き、ページの `requestAnimationFrame` で回す）より劣る構造になっている」という指摘があった。利用者の依頼は「制約を取り払う」。

利用者が貼った指摘の文章は「差が出るのは主に次の3点です。-」で切れていて、3 点の中身は届いていない。下の表は、コードと契約から洗い出したものである。抜けがあれば足す。

## 2. いまの描画の経路

```
作品（Worker）                         シェル（プレビューの iframe）            画面
─────────────                         ──────────────────────────            ────
WebGL を自前の OffscreenCanvas に描く
   │ drawImage（複写 1 回目）
   ▼
2D の面（api.ctx）
   │ drawImage（複写 2 回目）
   ▼
表示用の面 → transferToImageBitmap ──postMessage──▶ bitmaprenderer に差し替え ──▶ 表示

時計：シェルの requestAnimationFrame ──postMessage（tick）──▶ 作品の frame(t, dt)
```

素の Web ページは、画面の canvas に直接描き、自分の `requestAnimationFrame` で回す。複写も、メッセージの往復も無い。

## 3. 制約の一覧

「境界」の列は、外すと隔離（design.md §4）に影響するかどうか。

| # | 制約 | 出どころ | 困ること | 外し方 | 境界 | 冊 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | WebGL を表示の面に直接描けない。毎フレーム 2 回の全面複写と、画像の転送がある | `src/preview/bootstrap.js`（`api.canvas` は 2D、`present()`） | 高解像度・重いシェーダーで遅い。デモのブラックホールは半分の解像度で描いている | 画面の canvas を Worker に渡し（`transferControlToOffscreen`）、作品が直接描く。面は 2D と 3D の 2 枚にする | 変えない | 05 |
| 2 | フレームの時計がシェル経由 | `src/preview/shell.js`（`tick` を postMessage） | 1 フレーム分遅れうる | 直接描画のときは、Worker 自身の `requestAnimationFrame` で回す | 変えない | 05 |
| 3 | 観測は GPU なし（SwiftShader）で、時間を進める間 16ms ごとに毎回描画する | `src/core/observer.ts`、`bootstrap.js` の `advance` | 重い作品は観測に時間がかかる。**契約が「1 フレームの計算を重くしすぎない」と制作担当に求めている**（品質を自分で下げさせている） | 更新と描画を分ける形（`update`・`draw`）を足し、時間を進める間は更新だけ、描画は最後に 1 回。契約の文から「重くしすぎない」を外す。観測のブラウザの起動引数を設定できるようにする | 変えない | 05 |
| 4 | Three.js の後処理（発光・合成）のアドオンが無い | `src/preview/libs/three.js`（本体だけ） | bloom などの見た目が作れない | `EffectComposer`・`RenderPass`・`ShaderPass`・`UnrealBloomPass`・`OutputPass` を同じ束に入れ、`THREE.*` で渡す | 変えない（コードはホスト同梱の固定版） | 05 |
| 5 | 入力がキーとポインターだけ。ホイール・複数の指が無い | `src/preview/shell.js` | ホイールでの拡大縮小、2 本指の操作ができない | `wheel` を足す。ポインターに `id` を足す | 変えない | 05 |
| 6 | 入力のたびに `frame(t, 0)` が呼ばれる | `bootstrap.js` | P2・P3 のジャンプの失敗の原因。制作担当が毎回気を付ける必要がある | `update`・`draw` の形では、`dt = 0` で `update` を呼ばない（作りとして起きなくする）。`frame` の形は今のまま | 変えない | 05 |
| 7 | DOM が無い。HTML は SVG の画像としてしか描けず、押す・入力する・IME ができない | 作品は Worker で動く | フォーム・文字入力・普通の HTML の UI が作れない | 作品をメインスレッドで動かす（ページ直接モード） | **変わる** | 10 |
| 8 | 音が無い | Worker には `AudioContext` が無い | ゲームの効果音・音楽 | ページ直接モード | **変わる** | 10 |
| 9 | `requestAnimationFrame`・`setTimeout`・`Date.now` で進行を書けない。独自の `canvasApp.start` の形に合わせる必要がある | 契約 | モデルが慣れた「素の書き方」と違う | ページ直接モード＋仮想の時計（観測のときだけ時計を差し替える） | **変わる** | 10 |
| 10 | WebAssembly・Worker の生成・通信・保存が使えない | CSP、ブートストラップ | 一部の物理エンジン（WASM）、マルチスレッド | 外さない（通信・保存は隔離の中心。WASM と Worker は必要が出たら個別に検討） | 変わる | — |
| 11 | 作品の本文は 128 KiB まで、1 ファイル | `src/contract/artwork.ts` | いまのデモの最大は 34 KiB。当面は足かせになっていない | 変えない | — | — |
| 12 | WebKit（Linux の Playwright 版）は Worker で WebGL が使えない | 環境 | Three.js の作品が WebKit の試験で動かない | 実機の Safari で測る（未測定のまま） | — | — |

## 4. 方針

### 4.1 隔離を変えずに外せるものは、すぐ外す（05）

1〜6 は、作品を Worker の中に置いたまま外せる。通信・保存・eval・子 Worker の禁止、CSP、sandbox、別オリジンは一切変えない。05 で実装する。

- 作品から見た変更は**追加だけ**にする。いまの作品（`api.ctx` に描く、`frame(t, dt)` を返す）は 1 文字も変えずに動く。契約の版（`canvas-artwork/1`）と digest の計算は変えない。
- 直接描画（画面の canvas を Worker に渡す）は、実時間で動かすとき（利用者が見ているとき）だけ使う。観測・評価（手動の時計）は今の複写の経路を使う。作品のコードは同じで、表示への出し方だけが違う。
- 直接描画は Chromium 系だけで有効にする。WebKit では、Worker から描いた内容が表示に反映されない場合があった（design.md §4、P0 の実測）。WebKit は今の複写の経路のまま動く。

### 4.2 隔離に関わるものは、測ってから決める（10）

7〜9 を外すには、作品をメインスレッド（DOM のある文書）で動かす必要がある。そうすると、いま Worker と CSP で止めているものの一部が止められなくなる。

- **WebRTC による外向きの通信。** CSP には WebRTC を止める指示（`webrtc 'block'`）があるが、どのブラウザも出荷していない。API を消しても、作品が `<iframe>` を足せば、消す前の API を持つ新しい窓が手に入る。方針だけでは防げない。
- **無限ループ。** メインスレッドの無限ループは `terminate()` で止められない。Chromium は別サイトの iframe を別プロセスで動かすので、ホストは動き続け、iframe を外せば止まる。WebKit は別プロセスにしないので、ホストごと固まる。
- **判定の再現性。** 素の書き方（`requestAnimationFrame`・`Date.now`）を許すと、観測のために時計と乱数を差し替える仕組みが要る。

plan.md §4 の取込条件（「外部 HTTP・WebSocket、外部コード読み込み…の試験で侵害 0 件」「無限ループ中も…ホストが引き続き操作できる」）に関わるので、**実測の結果を利用者に見せ、残る危険を受け入れるかを決めてもらってから**実装する。10 に、実測の項目と判断の表を書いた。

## 5. 外したあとの比較（素の Web ページとの差）

| 観点 | いま | 05 の後（Chromium、実時間） | 10 の後 |
| --- | --- | --- | --- |
| WebGL の描き先 | 自前の面 → 2D の面へ複写 | 画面の canvas に直接 | 画面の canvas に直接 |
| 毎フレームの複写 | 2 回＋画像の転送 | 0 回 | 0 回 |
| 時計 | シェルの tick を postMessage | Worker の `requestAnimationFrame` | ページの `requestAnimationFrame` |
| 後処理（bloom など） | 自分で書く | `THREE.EffectComposer` ほか | 同左 |
| ホイール・複数の指 | 無い | ある | ある |
| HTML・文字入力・音 | 無い（HTML は画像だけ） | 無い | ある |
| 書き方 | `canvasApp.start` | `canvasApp.start` | 素の Web の書き方 |
| 隔離 | Worker＋CSP＋sandbox＋別オリジン | 同じ | sandbox＋別オリジン＋CSP（WebRTC と WebKit の停止に穴） |
