# P0 実行境界の結果

2026年11月9日。検証環境は Debian 13 の box、Playwright 1.56.1 同梱の **Chromium 141.0.7390.37** と **WebKit 26.0**（WPE、headless）。

## 採用した方式

専用プレビューオリジン方式。詳細は [design.md §4](../design.md#4-プレビューの実行境界)。

| 層 | 内容 |
| --- | --- |
| ホスト（`http://localhost:4310`） | CSP `default-src 'self'; frame-src <プレビューオリジン>; …`。iframe に `sandbox="allow-scripts allow-same-origin"`、`allow=""`。window の message は読まず、渡した MessagePort だけを読む。 |
| 固定シェル（`http://127.0.0.1:4311/shell.html`） | CSP `default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'none'; frame-ancestors <ホスト>`。親とホストオリジンを照合してポートを 1 回だけ受ける。 |
| 作品 Worker（`/w/<一度だけのトークン>`） | 応答 CSP `default-src 'none'`。固定ブートストラップが保存・同一オリジン通信の API を外してから作品を strict 関数で実行する。描画は ImageBitmap でシェルへ渡す。 |

対象ブラウザ：Chromium 141、WebKit 26.0（いずれも上記の固定版）。Fullscreen API の実ブラウザ測定は P1 の結果を参照。

## 脅威試験（`tests/e2e/p0-threats.spec.ts`）

作品の自己申告だけでなく、カナリアサーバーへの到達数、ホストの DOM・localStorage・cookie、Playwright が観測した Worker の数・終了で独立に確かめた。

| 脅威 | 試した操作 | Chromium | WebKit |
| --- | --- | --- | --- |
| 外部通信 | fetch（cors・no-cors）、XHR、WebSocket、EventSource | 侵害 0（到達 0） | 侵害 0（到達 0） |
| 外部コード読込 | importScripts、静的検査を避けた動的 import、eval、Function | 侵害 0（到達 0） | 侵害 0（到達 0） |
| 親画面・保存データ | document・parent・top・localStorage・indexedDB・caches・BroadcastChannel・cookieStore・navigator.storage・locks | 侵害 0 | 侵害 0 |
| 遷移・ポップアップ | 作品の open・location、シェル文書からの top 遷移・window.open | 侵害 0 | 侵害 0 |
| 子 Worker | Blob・data:・同一オリジン URL の Worker、SharedWorker | 起動 0 | 起動 0 |
| 過大・偽造メッセージ | 10 KB の status、未定義の型、偽の ready・advanced、親 window への偽装送信、2000 件の連続送信 | 破棄。連続送信は message-rate 違反で停止 | 同左 |
| 定常描画中の停止 | 停止後 400ms の画素差 | 0 | 0 |
| 無限ループ（frame 内・最上位） | 停止から Worker 終了まで | **2003–2004ms（未達）** | 2ms |

- 侵害の合計は 0 件。
- 無限ループ中も、ホストのボタン・入力欄は応答した。停止後に新しい作品を起動できた（両ブラウザ）。
- Chromium は、`terminate()` からおよそ 2 秒後に実行中の Worker を強制終了する。renderer プロセスの CPU 時間を 100ms 間隔で測ったところ、停止後 2.0–2.1 秒で 0 になった。iframe を除去しても同じだった。基準の「2 秒以内」は変えず、Chromium では未達として `test.fail` で記録している（速くなれば試験が知らせる）。
- 打てる手は 3 つ。(a) 基準を見直す（利用者の判断）。(b) 作品コードのループに停止確認を挿入する変換（構文解析が必要で、抜け道の検討も要る）。(c) 本体側でプレビュー用プロセスを強制終了できる構成にする。

## 不採用にした方式の基準線（`tests/e2e/p0-blob-baseline.spec.ts`）

| 方式 | Chromium | WebKit |
| --- | --- | --- |
| `allow-scripts` のみの iframe ＋ Blob Worker | 作品 Worker から子 Worker を起動・実行できた（不合格） | 不透明オリジンに `'self'` が一致せず、シェルを読めない |

## 試験環境の補足

- この box では WebKit の依存ライブラリ（libwoff2dec など 7 個）が足りず、apt のミラーも 500 を返した。Debian の `.deb` を `~/.cache/pw-webkit-libs` へ展開し、Playwright の WebKit の `sys/lib` にシンボリックリンクを張って動かした。製品コードには関係しない。
- 測っていないもの：実機のメモリ・GPU 上限、タブ閉鎖時の解放、モバイル端末の WebKit。
