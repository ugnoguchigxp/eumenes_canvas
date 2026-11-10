# 10 ページ直接モード（DOM・音・素の Web の書き方）：境界の実測と判断

**この冊では、本体の実装をしない。** 行うのは、境界を測る試験を書いて結果を文書にするところまで。本体の実装は、結果を利用者が見て、残る危険を受け入れると決めたあとに、別の手順書で行う。

## 1. 目的

04 の表の 7〜9（DOM が無い、音が無い、素の Web の書き方が使えない）を外すには、作品を Worker ではなく、**DOM のある文書のメインスレッド**で動かす必要がある。そうすると、いま Worker と CSP で止めているものの一部が止まらなくなる。何が止まり、何が止まらないかを、対象のブラウザ（Chromium・WebKit）で測る。

P0（design.md §4、`docs/p0-results.md`）と同じやり方である。P0 では、最初に考えた方式（Blob Worker）が隔離を満たさないことを実測で見つけ、方式を変えた。

## 2. 考えている方式（測る対象）

```
ホスト（http://localhost:4300）
  └─ iframe：シェル（http://127.0.0.1:4301/shell.html）      sandbox="allow-scripts allow-same-origin"（今と同じ）
        └─ iframe：作品の文書（http://127.0.0.1:4301/p/<token>）  sandbox="allow-scripts"（不透明オリジン）
              ├─ <canvas id="stage">（画面いっぱい）
              ├─ ホストの固定の実行時コード（時計・乱数・入力の橋渡し）
              ├─ 宣言された同梱ライブラリ
              └─ 作品の本文（素の Web の書き方：document.getElementById、requestAnimationFrame、addEventListener）
```

- 作品の文書は、`sandbox="allow-scripts"` だけの内側の iframe に入れる。`allow-same-origin` を付けないので、オリジンは不透明になり、プレビューオリジンの保存データ・cookie、シェルの DOM に届かない。
- 作品の文書の応答に付ける CSP（案）：

  ```
  default-src 'none'; script-src <プレビューオリジン>; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:;
  connect-src 'none'; worker-src 'none'; child-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'
  ```

  `script-src` に `'self'` ではなく**プレビューオリジンを明示**する。WebKit では、不透明オリジンの文書に `'self'` が一致しなかった（P0 の実測）。インラインのスクリプトと `eval` は許さない。作品の本文は `/w/<token>` から、1 回だけ使えるトークンで読む（今と同じ）。
- シェルの CSP に `frame-src <プレビューオリジン>` を足す（内側の iframe を読めるようにし、ほかのオリジンへの遷移を止める）。
- 観測のとき（手動の時計）は、実行時コードが `requestAnimationFrame`・`setTimeout`・`setInterval`・`performance.now`・`Date.now`・`Math.random` を、ホストが進める仮想の時計と seed 固定の乱数に差し替える。実時間で動かすときは、乱数だけ差し替える。

## 3. 測る項目

`tests/e2e/p0-threats.spec.ts` と同じ形で、新しい試験ファイル `tests/e2e/page-boundary.spec.ts` を書く。作品の文書を配信する最小の経路（`/p/<token>`）は、**試験用の待ち受けの中にだけ**作る（`tests/e2e/support/` に置く。`src/` には入れない）。外向きの通信が届いたかは、既存のカナリア（`tests/e2e/support/serve.ts`、`http://127.0.0.1:4312`）で数える。

各項目を Chromium と WebKit の両方で測り、「止まった・止まらなかった・測れなかった」を記録する。**止まらなかった項目があっても、試験を通すために条件を緩めない。** 結果をそのまま書く。

### 3.1 通信

| # | 試すこと（作品の文書の中で） | 期待 |
| --- | --- | --- |
| C1 | `fetch`・`XMLHttpRequest`・`WebSocket`・`EventSource`・`navigator.sendBeacon` でカナリアへ | カナリアに届かない |
| C2 | `new Image().src`、`<img>`、`<video>`、`<audio>`、`<link rel="stylesheet">`、CSS の `url()`、`@font-face` でカナリアへ | 届かない |
| C3 | `<script src=カナリア>` を足す | 読まれない・実行されない |
| C4 | `<link rel="dns-prefetch">`・`preconnect`・`prefetch`・`preload` でカナリアへ | 届かない（DNS の問い合わせは試験で数えられない。`preconnect`・`prefetch`・`preload` の HTTP の到達だけを数え、DNS は「測れなかった」と書く） |
| C5 | **`new RTCPeerConnection({ iceServers: [{ urls: "stun:127.0.0.1:<カナリアの UDP のポート>" }] })` を作り、`createDataChannel`・`createOffer`・`setLocalDescription` を呼ぶ** | 届かないのが理想。**CSP の `webrtc` の指示はどのブラウザも出荷していないので、止まらない見込み。** カナリアに UDP の待ち受けを足して、STUN の問い合わせが届くかを数える |
| C6 | 実行時コードが `RTCPeerConnection` を消したあとで、作品が `<iframe>` を足し、`iframe.contentWindow.RTCPeerConnection` を使う | 消した API が、新しい窓から手に入るか。手に入るなら「API を消す対策は効かない」と記録する |
| C7 | `eval`・`new Function`・`WebAssembly.compile`・`new Worker(blob:)`・`navigator.serviceWorker` | すべて失敗する |

### 3.2 遷移・窓

| # | 試すこと | 期待 |
| --- | --- | --- |
| N1 | `location.href = カナリア + "?leak=1"`（自分の文書を遷移させる） | カナリアに届かない（シェルの `frame-src` が止めるかを測る） |
| N2 | `<meta http-equiv="refresh">`、`<a href target="_self">` を押す、`<form>` を送る | 届かない |
| N3 | `window.open`、`<a target="_blank">` | 窓が開かない |
| N4 | `top.location = …`、`parent.location = …` | 変わらない |

### 3.3 親・保存

| # | 試すこと | 期待 |
| --- | --- | --- |
| S1 | `parent.document`、`top.document` を読む | 例外 |
| S2 | `localStorage`、`indexedDB`、`document.cookie`、`caches`、`navigator.storage` | 例外か、空で、プレビューオリジンのデータに届かない |
| S3 | `parent.postMessage`・`top.postMessage` で、ホストに権限を求める型（`save` など）を送る | ホストが無視する（ホストは専用のポート以外のメッセージを受けない） |
| S4 | 作品が、シェルとの専用のポートを横取りして、ホストに偽の通知を送る | ホストの検査（`checkShellToHost`）を通るのは、今ある型と上限のものだけ。権限は増えない |

### 3.4 停止

| # | 試すこと | 期待 |
| --- | --- | --- |
| H1 | 作品のメインスレッドで `for (;;) {}`。その間に、ホストの画面のボタンを押す | ホストが反応する |
| H2 | その状態で、ホストが停止を指示する（シェルが内側の iframe を外す。シェルが応答しなければ、ホストがシェルの iframe を読み直す） | 2 秒以内に作品の処理が止まり、新しい作品を起動できる |
| H3 | 作品が大量の DOM を足し続ける・メモリを使い続ける | ホストが操作でき、停止できる |

Chromium は別サイトの iframe を別プロセスで動かすので、H1 は通る見込み。**WebKit は別プロセスにしないので、H1 は通らない見込み**（ホストごと固まる）。試験が固まって終わらないことがあるので、H の試験には短い制限時間を付け、時間切れを「止まらなかった」と記録する。

### 3.5 観測の再現性

| # | 試すこと | 期待 |
| --- | --- | --- |
| D1 | 素の書き方の作品（`requestAnimationFrame` の輪、`setTimeout`、`Date.now`、`Math.random`）を、手動の時計で 2 回動かす | 同じ時刻の画面が一致する |
| D2 | ホストが 1000ms 進める | `requestAnimationFrame` の関数が約 62 回（16ms ごと）呼ばれ、渡される時刻と `performance.now()` が仮想の時計の値になる |
| D3 | 作品が `<iframe>` を足して、差し替える前の `Date.now` を取り出す | 取り出せるか（取り出せるなら、再現性は「作品が意図して壊せる」と記録する。意図しない作品では問題にならない） |

## 4. 結果の書き方

`docs/page-mode-boundary.md` に、項目ごとの結果の表（Chromium・WebKit）と、使った版（Playwright・ブラウザ）を書く。事実（測ったこと）、推定（測っていない見込み）、未測定を分ける。実機の Safari・Firefox は未測定として残す。

## 5. 判断の表（利用者に見せる）

結果が出たら、次の表を埋めて利用者に見せる。**決めるのは利用者である。**

| 項目 | 見込み | 受け入れる場合の条件 | 受け入れない場合 |
| --- | --- | --- | --- |
| WebRTC による外向きの通信（C5・C6） | 止まらない | 作品に渡すデータを、外に出てもよいものに限る（今の合成データ）。認証済みのデータを渡す用途（design.md §1 のライブダッシュボード）では、ページ直接モードを使わせない | ページ直接モードを作らない。05 の直接描画までにする |
| DNS による持ち出し（C4） | 測れない | 同上 | 同上 |
| WebKit での無限ループ（H1・H2） | ホストが固まる | ページ直接モードは Chromium 系だけで有効にする。WebKit では Worker の方式（今の方式）で動く作品だけを開く | 同上 |
| 自分の文書の遷移（N1・N2） | 測る | 止まること | 止まらなければ作らない |
| 親・保存（S1〜S4） | 止まる見込み | 止まること | 止まらなければ作らない |

plan.md §4「隔離と停止」の合格条件（「外部 HTTP・WebSocket、外部コード読み込み、遷移・ポップアップ、越権メッセージの試験で侵害 0 件」「無限ループ中もホストの停止から 2 秒以内に…終了する。ホストが引き続き操作できる」）を、ページ直接モードについてどう読むかも、あわせて決めてもらう。条件を変える場合は、plan.md §4 に「ページ直接モードの条件」を別に書く（今の条件を書き換えない）。

## 6. 受け入れると決まったあとの実装の輪郭（参考）

ここは手順書ではない。決まったあとに、別の冊として書く。

- **作品の形。** 契約の新しい版（`canvas-artwork/2`）。作品の項目に `runtime: "page"` を足す（無い作品は今の Worker の方式）。digest は、`runtime` があるときだけ計算に入れる（保存済みの作品の digest を変えない）。
- **書き方。** 画面いっぱいの `<canvas id="stage">` がある文書で、作品の本文が普通のスクリプトとして動く。`document`・`requestAnimationFrame`・`addEventListener`・Web Audio を使える。ホストからのデータは `canvasHost.data`、seed 固定の乱数は `Math.random`（差し替え済み）。
- **入力。** 利用者の入力は、内側の文書に直接届く（シェルの橋渡しは要らない）。Tab と Esc はホストが使うので、内側の文書で捕まえてシェルへ渡す。
- **観測。** 画面写しは今と同じ（`#frame` を撮る）。HTML の要素も写る。時間は仮想の時計で進める。03 の観測のうち、dt = 0 の不変性は対象外（`frame(t, 0)` が無い）。
- **評価。** 既存の判定（`eval/checks/`）は `canvasApp.start` の形の作品を前提にしていない（画素だけを見る）ので、ページ直接モードの作品にも当てられる見込み。ただし、仮想の時計の刻みが今と同じ（16ms）であることを確かめる必要がある。
- **制作担当。** 制作手順と契約の文書を、版ごとに分ける。どちらの版で作るかは、設定で決める（依頼の語句で分けない）。
- **05 との関係。** 05 の直接描画・`update`/`draw`・後処理は、Worker の方式の作品のためのもので、そのまま残る。

## 7. 手順（この冊で行うこと）

1. `tests/e2e/support/` に、作品の文書を配信する試験用の経路を足す（`/p/<token>`、2 節の CSP、内側の iframe を置く試験用のシェル）。`src/` は変えない。
2. カナリアに UDP の待ち受けを足す（C5 用）。
3. `tests/e2e/page-boundary.spec.ts` に 3 節の項目を書く。止まらない見込みの項目（C5・C6・H1 の WebKit）は、`expect` で落とすのではなく、結果を記録する形にする（試験の名前に「実測」と書き、結果を JSON に出す）。止まるべき項目（C1〜C3・C7・N1〜N4・S1〜S4）は `expect` で確かめる。
4. 実行して、`docs/page-mode-boundary.md` に結果を書く。
5. 5 節の表を埋めて、利用者に見せる。

## 8. 完了の確認

```sh
bun run typecheck
bunx playwright test tests/e2e/page-boundary.spec.ts
bun run verify
```

- `page-boundary.spec.ts` の「止まるべき項目」がすべて通ること。通らない項目があれば、方式（2 節）を見直す。見直しても止まらなければ、「この方式では作れない」と結果に書く。
- 既存の試験（`p0-threats.spec.ts` を含む）が変わらず通ること。この冊は `src/` を変えない。

## 9. 間違えやすい点

- **`src/` に手を入れない。** この冊は測るだけ。製品のプレビューに、内側の iframe の経路を足さない。
- **止まらない項目を隠さない。** C5（WebRTC）は止まらない見込みである。「止まらなかった」と書くのが、この冊の成果である。
- **API を消す対策を、対策として数えない。** C6 で確かめるとおり、新しい窓から元の API が手に入るなら、消しても意味が無い。
- **シェルに `allow-same-origin` を足さない（内側）。** 内側の iframe は `allow-scripts` だけ。足すと、作品がプレビューオリジンの保存データとシェルの DOM に届く。
- **無限ループの試験でブラウザを固めたままにしない。** 制限時間を付け、終わったらコンテキストを閉じる。
