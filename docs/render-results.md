# 描画方式の拡張の結果（デモ・最小化・計測基板）

2026-11-10。方式は [design.md §7](../design.md)、契約は [artwork-contract-v1.md](artwork-contract-v1.md)、計測基板は [eval/render-v1.md](eval/render-v1.md)。環境は Playwright 1.56.1 の Chromium 141.0.7390.37 headless（WebGL は ANGLE の Vulkan 上の SwiftShader、GPU なし）と WebKit 26.0、Linux。以下、**実測**は今回この環境で測った値、**推定**は測っていない見込み、**未測定**は測っていないもの。

## 1. 同梱したもの（実測）

| id | 作品での名前 | 出どころ | 束ねた大きさ |
| --- | --- | --- | ---: |
| `three@0.187.0` | `THREE` | npm `three` 0.187.0（exact 固定、ESM を Bun.build で IIFE・minify） | 755,502 バイト |
| `cannon-es@0.20.0` | `CANNON` | npm `cannon-es` 0.20.0（純 JavaScript、MIT） | 124,764 バイト |

作品の `entry` は 128 KiB の上限のまま（ライブラリは数えない）。実行時の通信・動的 import・eval・WebAssembly は従来どおり拒否される（`tests/e2e/render.spec.ts` の「同梱ライブラリと隔離」）。

## 2. デモ（`examples/render/`、`bun scripts/render-demos.ts`）

各デモを共通プレビュー（480×360、DPR 1、手動の時計）で起動し、`examples/render/demos.json` の手順（待つ・キー・クリック・ドラッグ）で動かし、各段の画面を `eval/out/render-demos/`（git の対象外）に残した。最後に製品と同じ観測 host-smoke/2 に通した。`fixtures/demo/recordings.json` からも同じファイルを読む（複製しない）。`bun scripts/seed-demo.ts` で通常の経路を通すと、ゲーム 4 題と同じく検証ホストの作品一覧に出て、クリックで開ける。

| デモ | 使うもの | 起動（ready まで） | advance(1000) の壁時計 | host-smoke/2 | 見えたこと（画面写しを目で確認） |
| --- | --- | ---: | --- | --- | --- |
| three-scene | Three.js（照明・影・ドラッグで回す・クリックで色を変える・HTML の名札を CanvasTexture） | 301ms | 48〜592ms（最初が最も遅い） | ○起動 ○実行時エラーなし ○単色でない ○反応する（3.9 秒） | 影・照明・名札が写る。クリックで立方体の色が変わる |
| marble-run | Three.js ＋ cannon-es（4 段の坂・壁・ガラス・最大 12 個） | 218ms | 50〜533ms（玉が増えると遅くなる） | ○○○○（3.3 秒） | 約 15 秒で 12 個が出て、3 個が箱に着く（status `inBin: 3`）。坂の上で詰まらない |
| pinball | Three.js ＋ cannon-es（フリッパー・プランジャー・バンパー・HTML の得点板） | 150ms | 48〜235ms | ○○○○（2.8 秒） | 台・フリッパー・バンパー・得点板が写る。プランジャーで球が出る |
| black-hole | Three.js の ShaderMaterial（光線の曲がりを積分、半分の解像度） | 135ms | 最初 1,722ms（シェーダーの準備）、以後 81〜852ms | ○○○○（7.5 秒） | 影・降着円盤・上に回り込む弧・星。↑↓で見込む角度が変わる |
| html-card | api.decodeSVG（表・進捗バー・ボタン・入力欄の HTML/CSS）＋ 2D の背景 | 67ms | 27〜50ms | ○○○○（2.5 秒） | ボタン（作品の当たり判定）で配色・数が変わり、キー入力が入力欄に出る（status `dark: true, count: 2, text: "hi"`） |

（2026-11-10 の最後の実行。advance(1000) の値は手順の各段の 1 秒ずつ。）

### 2.1 デモで起きた失敗と直したこと（実測）

| デモ | 起きたこと | 原因（確かめたこと） | 直し方 |
| --- | --- | --- | --- |
| marble-run | 玉が坂の途中で止まる | cannon-es の眠り（sleep）が、ゆっくり転がる玉を止めた | 眠りを使わない |
| marble-run | 玉が壁をすり抜ける | SAPBroadphase で、静的な細い箱との接触を取りこぼした | 既定の broadphase（NaiveBroadphase）に戻す |
| marble-run | 玉が坂と坂の間で詰まる | 上の坂の低い端と下の坂の間が 0.42 で、玉の直径 0.5 より狭い | 坂の配置を作り直し、高い側の端を壁に付ける |
| marble-run | 重なって出た玉がはじけて壁を越える | 出口に玉があるのに次を出した | 出口が空くまで出さない・天井を置く・壁を高くする |
| black-hole | 円盤に放射状の継ぎ目が出る | 模様の角度を `atan` で取ったため、±π で値が飛ぶ | 回転した座標で値ノイズを取る（角度を使わない） |
| pinball | 同じ入力でも Bun（シミュレーター）と Chromium で軌跡が違う | 浮動小数・Math の実装と入力の届く時刻の差（推定） | 判定・試験は軌跡に依存させない（下の §3・§4） |
| html-card | 日本語の文字が別の字形になる | headless の Linux に日本語のフォントが少ない（環境の問題） | 判定は文字の形を使わない（色の領域・画素の差だけ） |
| （ホスト） | Chromium で SVG から作った ImageBitmap を Worker へ送れない（DataCloneError） | `<img>` の SVG は origin-clean でないとみなされる | シェルで OffscreenCanvas に描いてから取り出す |
| （ホスト） | WebKit が CSP に関係なく WebAssembly を動かせた | WebKit の CSP は WASM のコンパイルを止めない | ブートストラップで作品から `WebAssembly` を外す |

### 2.2 残った見え方の癖（実測、直していない）

- black-hole の影の中に、光子球の近くで点々の輪が出る（積分の刻みが粗い所の誤差）。判定には使っていない。
- WebKit（Linux）は Worker で WebGL を使えない。Three.js のデモはすべて「Error creating WebGL context」の実行時エラーになる（無言の空白にはならない）。

## 3. 最小化した試験（`tests/e2e/render.spec.ts`）

デモの全体は試験にしない。デモで成功を見分けた画素・振る舞いだけを残した小さな作品で試す。

| デモで見たこと | 最小化した試験 |
| --- | --- |
| three-scene の場面が写る・時間とキーで変わる | WebGL の 1 枚の板の画素が作品の面に写り、時間とキーで変わる／写し忘れると単色として観測で見つかる／WebKit では実行時エラー |
| black-hole の影・輪・時間変化 | 全画面の ShaderMaterial：中心の影・外の輪・時間で変わる模様 |
| marble-run の落下・停止・すり抜け | cannon-es の球が落ちて床で止まり、`dt=0` では進まない |
| pinball のフリッパー | 運動学的な物体を押下中だけ回し、球を打ち上げる |
| marble-run・pinball の「物理 → Three.js」 | 両方を宣言し、物理の位置を WebGL の場面に写す |
| html-card・pinball の得点板 | HTML/CSS が画素になる、`ready` は setup 中の復号を待つ、復号が済むと `dt=0` で描き直す／HTML の画像を Three.js のテクスチャにする |
| （隔離） | SVG の外部資源・スクリプトが動かない、壊れた SVG・上限超えは失敗、毎秒 30 件を超えると失敗、ライブラリを宣言しても通信・eval・WASM・ローダーは拒否、未宣言のライブラリは使えない |

試験は 13 件。Chromium で 12 件合格（WebKit 専用の 1 件は飛ばす）、WebKit で 8 件合格（WebGL を使う 5 件は飛ばし、WebKit の WebGL の失敗を確かめる 1 件を動かす）。計 20 件合格・6 件スキップ。全体の Playwright は 104 件合格・6 件スキップ（この拡張の前は 84 件合格）。

## 4. 計測基板 render-v1（`docs/eval/render-v1.md`）

デモの失敗の起き方を 1 課題 1 つの仕組みに縮めた 6 課題。R-T1-cube（Three.js の投影・回転・クリックの当たり）、R-H1-panel（HTML の組版・非同期の描き直し）、R-P1-pile（重なり・止まる・上限）、R-P2-marbles（坂・すり抜け・箱）、R-P3-flipper（運動学的なフリッパー・落とし直し）、R-V1-blackhole（シェーダーの構造・時間・キー・所要時間）。判定は画素だけで、物理は経路に依存しない性質だけを見る。

自己確認（`bun eval/render/self-test.ts`、記録は `docs/eval/render-v1-self-test.json`）：対照 24 件（黒一色 6・参照 6・変異 12）がすべて期待どおり（不一致 0、所要 226 秒）。同じ自己確認をもう 1 回行い、各観点の合否と観測値（所要時間を除く）が 1 回目と一致した（同じ環境での再現）。

参照の作品の観測値の例（実測）：立方体の見かけの幅 146px → π/4 秒で 174px → π/2 秒で 146px（透視投影から計算した 147・175・147 と合う）、marble run の箱に 12 秒で 5.7 個分、フリッパーで打ち上げた球の最高位置 y=44、ブラックホールの影の半径は高さの 20.0%・advance(1000) の壁時計 1.8 秒。

## 5. 未測定と残る危険

- **未測定：** 制作担当（Grok Bot の応答者・実モデル）が render-v1 の課題を作れる割合。生成ランは 1 回も行っていない。
- **未測定：** 実 GPU・macOS の Safari・Firefox・モバイルでの描画と所要時間。SwiftShader と実 GPU で画素が一致する保証はない（判定は許容幅で吸収する前提だが、確かめていない）。
- **未測定：** 束ねたライブラリ（約 0.9 MB）を毎回 Worker に連結する読み込み時間の、遅い端末での影響。
- **危険：** render-v1 の判定は参照の作品と 12 の変異でしか確かめていない。参照と違う正しい作り方（例：Three.js でなく 2D で描く、物理エンジンを使わず自前で解く、別の刻み幅）で誤って不合格になる観点が残っている可能性がある。特に R-P2（12 秒で箱に 4 個以上）と R-P3（打ち上げの時刻を観測で決める）は、物理の調整が違う作品で揺れうる（推定）。
- **危険：** HTML の描画は SVG の foreignObject による画像化で、IME・文字選択・アクセシビリティ・フォームの操作は扱わない。日本語の字形は環境のフォントに依存する。
- **危険：** WebKit（Linux）の Worker では WebGL が使えない。Safari の実機で使えるかは未測定。
