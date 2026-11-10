# ページ直接モードの境界：実測の結果

docs/agent-plan/10-page-mode.md の 3 節の項目を、`tests/e2e/page-boundary.spec.ts` で測った結果である。この冊は測るだけで、`src/` は変えていない（ページ直接モードは作っていない）。**受け入れるかどうかを決めるのは利用者である**（5 節の表）。

## 0. 利用者の決定（2026-11-11）

利用者は、5 節の表を見たうえで、**ページ直接モードを受け入れる**と決めた。受け入れた残りの危険は、WebRTC による外向きの通信（C5）、WebKit での WebAssembly（C7）、WebKit でのホストの固まり（H1・H2）の 3 つ（DNS の持ち出し C4 は測れないまま）。実装は 5 節の「受け入れる場合の条件」に従い、既定は無効、Chromium 系だけで開く、開くたびに警告を出す、渡すデータは登録済みの合成データだけ、とする（[design.md §8](../design.md)）。ページ直接モードの合格条件は plan.md §4 の「ページ直接モードの条件」に別に書いた（Worker の作品の条件は変えていない）。

## 1. 使った版と条件

| 項目 | 値 |
| --- | --- |
| Playwright | 1.56.1 |
| Chromium | 141.0.7390.37（Playwright の chromium-1194。既定は headless shell） |
| WebKit | 26.0（Playwright の webkit-2215） |
| OS | Linux（box、headless） |
| 測った日 | 2026-11-11（Asia/Tokyo） |

構成（試験用の待ち受けの中だけ。`tests/e2e/support/page-boundary.ts`）：

- ホスト `http://localhost:4316/`（CSP `script-src 'self'`）→ シェル `http://127.0.0.1:4317/shell.html`（`sandbox="allow-scripts allow-same-origin"`、CSP の `frame-src` はプレビューオリジンだけ）→ 作品の文書 `/p/<token>`（`sandbox="allow-scripts"`、10 §2 の CSP）。
- 作品の文書には、固定の実行時コード（`/rt.js`：仮想の時計・seed 固定の乱数・RTCPeerConnection を消す選択）と作品の本文（`/w/<token>`、1 回だけ読める）だけが入る。
- ホストは、専用のポート（MessageChannel）で受けたメッセージだけを `checkShellToHost`（`src/shared/messages.js`）で検査する。窓の message は数えるだけ。
- 外向きの通信は、既存のカナリア（`127.0.0.1:4312`）で数える。UDP の待ち受け（Chromium 用 4318、WebKit 用 4319）を足し、`/__udp` で届いた数を返す。
- 生の結果は、試験を走らせると `test-results/page-boundary-<ブラウザ>.json` に出る（コミットしない）。

## 2. 結果（事実：測ったこと）

「止まった」＝期待どおり防がれた。「止まらなかった」＝防がれなかった。「測れなかった」＝この試験では数えられない。

### 2.1 通信

| # | Chromium | WebKit | 記録の要点 |
| --- | --- | --- | --- |
| C1 fetch・XHR・WebSocket・EventSource・sendBeacon | 止まった | 止まった | カナリアへの到達 0。sendBeacon は true（queued）を返したが届かなかった。WebKit の WebSocket・EventSource は SecurityError を投げた |
| C2 画像・video・audio・stylesheet・CSS url()・@font-face | 止まった | 止まった | 到達 0 |
| C3 `<script src=カナリア>` | 止まった | 止まった | 読まれない・実行されない |
| C4 preconnect・prefetch・preload（HTTP） | 止まった | 止まった | HTTP の到達 0 |
| C4 dns-prefetch（DNS）・preconnect（TCP） | 測れなかった | 測れなかった | DNS の問い合わせと TCP の接続だけは数えられない |
| **C5 WebRTC（STUN）** | **止まらなかった** | **止まらなかった** | 両方で、カナリアの UDP の待ち受けに STUN の問い合わせが 4 回届いた（候補は host） |
| C6 消した RTCPeerConnection を新しい iframe から取り出す | 止まった | 止まった | 実行時コードが消したあと `iframe.contentWindow` に触ると SecurityError。新しい窓から取り出せなかった。UDP の到達 0 |
| C7 eval・new Function・Blob の Worker・serviceWorker | 止まった | 止まった | EvalError・EvalError・error・SecurityError |
| **C7 WebAssembly.compile** | 止まった（CompileError） | **止まらなかった**（コンパイルが通った） | WebKit は、`wasm-unsafe-eval` の無い CSP でも WebAssembly.compile を止めない |

### 2.2 遷移・窓

| # | Chromium | WebKit | 記録の要点 |
| --- | --- | --- | --- |
| N1 `location.href = カナリア` | 止まった | 止まった | 到達 0 |
| N2 meta refresh・`<a target=_self>`・form | 止まった | 止まった | 到達 0 |
| N3 window.open・`<a target=_blank>` | 止まった | 止まった | open は null、新しい窓 0 |
| N4 top.location・parent.location | 止まった | 止まった | SecurityError。ホストとシェルの URL は変わらない |

### 2.3 親・保存

| # | Chromium | WebKit | 記録の要点 |
| --- | --- | --- | --- |
| S1 parent.document・top.document | 止まった | 止まった | SecurityError |
| S2 localStorage・indexedDB・cookie・caches・navigator.storage | 止まった | 止まった | 4 つは SecurityError。navigator.storage は Chromium で TypeError、WebKit では undefined。シェル（プレビューオリジン）に置いた値に届かない |
| S3 parent・top への postMessage（save など） | 止まった | 止まった | 窓の message は 2 件届いたが、ホストは扱わない（受けた型は正規の shell-ready だけ、save 0） |
| S4 専用のポートを横取りして偽の通知 | 止まった | 止まった | 検査を通ったのは status（上限内）と shell-ready だけ。save・grant・上限超え・別の runId・余分な項目・型の違う値は落ちた。権限は増えない |

S4 の補足：作品から偽の shell-ready が届くと、ホストがシェルに作品の載せ直しを指示してしまう、という試験のホストの不具合が最初の実行で出た。shell-ready は「シェル 1 つにつき最初の 1 回だけ扱う」に直した。実装するときも同じ扱いが要る。

### 2.4 停止

| # | Chromium（既定の headless shell） | Chromium（`--site-per-process`） | WebKit | 記録の要点 |
| --- | --- | --- | --- | --- |
| **H1 無限ループ中のホストの操作** | **止まらなかった** | 止まった | **止まらなかった** | 既定の headless shell と WebKit では、ホストのボタンが反応しない（ホストごと固まる） |
| **H2 停止と 2 秒以内の再起動** | **止まらなかった** | 止まった | **止まらなかった** | `--site-per-process` では、シェルが約 20ms で応答して内側の iframe を外し、約 140ms で新しい作品が動いた。ほかの 2 つは停止の指示が時間切れ（5 秒） |
| H3 DOM・メモリを使い続ける作品 | 止まった | 止まった | 止まった | ホストは操作でき、停止は約 20ms、再起動は約 0.1 秒 |

H の補足（事実）：Playwright の既定の Chromium（headless shell）では、別サイト（localhost と 127.0.0.1）の iframe が同じプロセスに入った（CDP の Page.getFrameTree で、シェルがホストの中の子として見える）。`--site-per-process` を付けると別プロセスになり、ホストは固まらなかった。

### 2.5 観測の再現性

| # | Chromium | WebKit | 記録の要点 |
| --- | --- | --- | --- |
| D1 手動の時計で 2 回動かす | 止まった（一致） | 止まった（一致） | 同じ時刻の画面写しが一致 |
| D2 1000ms 進める | 止まった | 止まった | rAF は 62 回。渡される時刻と performance.now は 16, 32, 48…（仮想の時計） |
| D3 新しい iframe から元の Date.now を取り出す | 止まった | 止まった | SecurityError で取り出せなかった |

## 3. 推定（測っていない見込み）

- **C5 は、CSP では止められない。** CSP の `webrtc` の指示を出荷しているブラウザが無いため（10 §3.1 のとおり）。C6 で新しい窓から取り出せなかったので、実行時コードで RTCPeerConnection を消すと、この構成の中では効く見込みがある。ただし 10 §9 のとおり、API を消すことは対策として数えない（取り出す経路が他に無いことを、すべて確かめたわけではない）。
- **C6・D3 の SecurityError の理由は確かめていない。** 作品の文書の CSP（`child-src`・`frame-src 'none'`）か、不透明オリジンの扱いのどちらかと見込む。ブラウザの版で変わりうる。
- **H1・H2 は、実際の Chrome（デスクトップ）では止まる見込み。** デスクトップの Chrome はサイトごとのプロセス分離が既定なので、`--site-per-process` の結果に近いと見込む。Android など、分離が既定で弱い環境では、既定の headless shell の結果に近いと見込む。
- **C7 の WebAssembly（WebKit）：** 通信や親への到達ではなく、計算の手段が増えるだけと見込む（ほかの項目で外への経路は止まっている）。ただし「すべて失敗する」という期待は満たしていない。
- **C4 の DNS：** `dns-prefetch` でブラウザが DNS を引けば、名前に載せたデータが外へ出うる。数えていない。

## 4. 未測定

- 実機の Safari（macOS・iOS）、Firefox。
- デスクトップの実際の Chrome（headless shell ではないもの）での H1・H2。
- C4 の DNS の問い合わせと preconnect の TCP の接続。
- 音（Web Audio）を使う作品の観測と停止。

## 5. 判断の表（利用者に見せる。決めるのは利用者）

| 項目 | 結果（Chromium / WebKit） | 受け入れる場合の条件 | 受け入れない場合 |
| --- | --- | --- | --- |
| WebRTC による外向きの通信（C5・C6） | 止まらなかった / 止まらなかった（STUN が届いた）。消した API は新しい窓から取り出せなかった | 作品に渡すデータを、外に出てもよいものに限る（今の合成データ）。認証済みのデータを渡す用途（design.md §1 のライブダッシュボード）では、ページ直接モードを使わせない | ページ直接モードを作らない。05 の直接描画までにする |
| DNS による持ち出し（C4） | 測れなかった / 測れなかった（HTTP の到達は 0） | 同上 | 同上 |
| WebKit での無限ループ（H1・H2） | 既定の headless shell では固まった・`--site-per-process` では止まった / 固まった | ページ直接モードは、サイトごとのプロセス分離のある Chromium 系だけで有効にする。WebKit では Worker の方式（今の方式）で動く作品だけを開く | 同上 |
| WebAssembly（C7） | 止まった / **止まらなかった** | WebKit でページ直接モードを使わないなら、影響しない。使うなら「WebKit では wasm が動く」ことを受け入れる | 2 節の方式のままでは WebKit で C7 を満たせない（この方式では作れない） |
| 自分の文書の遷移（N1・N2） | 止まった / 止まった | 止まること（満たした） | — |
| 親・保存（S1〜S4） | 止まった / 止まった | 止まること（満たした）。shell-ready は最初の 1 回だけ扱う | — |
| 観測の再現性（D1〜D3） | 止まった / 止まった | 仮想の時計で再現できる（満たした） | — |

あわせて決めてもらうこと：plan.md §4「隔離と停止」の合格条件を、ページ直接モードについてどう読むか。変える場合は、plan.md §4 に「ページ直接モードの条件」を別に書く（今の条件は書き換えない）。この冊では plan.md を変えていない。

## 6. 試験の作り（再実行の仕方）

```sh
bunx playwright test tests/e2e/page-boundary.spec.ts
```

- 止まるべき項目（C1〜C3・C7・N1〜N4・S1〜S4・D1・D2）は `expect` で確かめる。
- 止まらない見込みの項目（C4〜C6・H・D3）は、試験の名前に「実測」と付け、結果を記録するだけにする（条件は緩めていない）。
- C7 の WebAssembly は別の試験（C7-wasm）にし、WebKit では `test.fail` で「止まらない」ことを記録している。WebKit が止めるようになれば、この試験は「予期せず通った」で落ちて知らせる。
- H は Chromium で既定と `--site-per-process` の 2 通りを測る（WebKit では後者を飛ばす）。固まったときも、制限時間のあとでコンテキストとブラウザを閉じる。
