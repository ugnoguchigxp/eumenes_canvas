# P3 評価の設計と凍結記録（直接生成・Collaborator・Pursuit）

2026-11-10 作成。plan.md の P3「Pursuit／Claude Code を比較」のうち、利用者の指示（2026-11-09）により **Claude Code の代わりに Collaborator** を加え、次の 3 条件を同じ課題・同じ判定・同じ上限で比べる。Eumenes 本体のリポジトリは使わない。

| 条件 | 制作担当への渡し方 | 次の試行の選び方 |
| --- | --- | --- |
| **D** 直接生成 | 製品の `ModelPort` 入力（依頼・会話・基準作品・公開契約・データの説明・前の候補・ホスト観測）をそのまま 1 回の推論に渡す | ホストの修正ループ（初回＋修正 2 回）。前の候補の観測を次の推論に渡す |
| **C** Collaborator | eumenes-collaboration の公開入口（`buildCollaborationMessages`・`createCollaborationContract`・`collaborationInstructions`）で組んだ文脈。応答は 4 action（reply・invoke・return・discard）の JSON 一つ | 作品は登録操作 `artwork.propose` の invoke で出す。検査に落ちた案は `document.rejected`（issues・fixes）として次の推論に渡す |
| **P** Pursuit | eumenes-pursuit の engine（`spec/host-contract-v1.md`）。目標・受入条件・道具・作業領域・照合をホストが渡す | 方針→仮説→道具の試行（反証条件付きの予測）→振り返り。試行の観測から次の試行を選ぶ |

## 固定した版

| 対象 | 版 |
| --- | --- |
| eumenes_canvas（判定・課題・元作品） | 課題・元作品・判定 v1 は commit `0edd712`（P2 で凍結）。判定 v2 は N3 だけを変えた参考版（P2 の結果を見た後の変更） |
| eumenes-collaboration | `b03426226ef5ef6ead47c216a309bb48c2a420df`（origin/main、0.3.0） |
| eumenes-pursuit | `f6a0318fbfb33f0d633a707397fd187d215caf21`（origin/main） |

2 つのリポジトリは `git archive <commit>` を `/workspace/p3-deps/<名前>/` に展開して参照する（`eval/p3/deps.json` に版を書き、`eval/p3/setup-deps.sh` で再現する）。canvas の製品コード（`src/`）は参照しない。依存の追加・変更は eval の中だけ。

## 役割の分離

- **評価担当（executor）**：この文書・接続（adapter）・実行器・判定の実行・集計を担当する。P2 の結果文書（`docs/p2-results.md`、N1・N3 の不合格の原因を含む）を読んでおり、判定コードも読める。したがって **制作の推論は一切行わない**。
- **制作担当（generator）**：条件×反復ごとに新しい応答者（新しいセッション）。条件 D・C・P × 3 反復で 9 名。同じ応答者を別の条件・別の反復に使わない（前の条件の案を覚えていると比較にならないため）。
- **振り返り担当（reviewer、P だけ）**：P の反復ごとに別の新しい応答者（3 名）。Pursuit の `review` を答える。
- 制作担当・振り返り担当が読んでよいのは、実行器が要求ファイルとして渡すもの（依頼・基準作品・公開契約・データの説明・ホスト観測・条件ごとの指示）と自分の作業メモだけ。**読んではいけないもの**：eumenes_canvas のリポジトリ全体（特に `eval/checks/`・`eval/recordings/`・`docs/eval/`・`docs/p2-results.md`）、`/workspace/p3-deps/`、他の実行ディレクトリ、`/workspace/canvas_p3/*/grade/`、Web。
- 判定（隠れた検査）の結果は、全条件・全反復の制作が終わるまで実行し、記録は制作担当から見えない場所（`/workspace/canvas_p3/grade/`）に置く。制作担当には、ホスト観測（host-smoke/1）の結果しか渡らない。これは 3 条件で同じ。
- 推論は Grok Bot の応答者が代行する（Luna／Haiku は利用者のローカルモデルで、この環境からは呼べない）。記録には `stand-in: Grok Bot responder` と付ける。

## 課題と判定

- 課題：`eval/tasks/heldout.json` の 13 件（新規 4・部分修正 4・修復 4・非ゲーム 1）。元作品は `eval/bases/`。
- 判定：**正式は v1**（`0edd712` の `eval/checks/heldout.ts`。`eval/p3/checks-v1.ts` に同じ内容を固定し、digest を記録する）。v2 の N3 は参考として別欄に出し、正式な数に混ぜない。
- N3 は P2 の後に判定の調整に使ったため、plan.md §3.2 の「未使用課題」には当たらない。表では N3 を含む数と含まない数を分けて出す。
- 合格の定義は P2 と同じ：全ターンで候補が提示・保存され、保存された最終版が課題の判定（change・retain・start）にすべて合格する。

## 上限（3 条件で同じ）

- **作品の提出**（契約検査＋ホスト観測を 1 回通すこと）は、1 ターンあたり最大 3 回（初回＋修正 2 回）、全ターン合計 6 回。D はホストの修正ループ、C は `artwork.propose` の invoke、P は道具 `write_artwork` がこれに当たる。上限を超える提出はホストが拒否する。
- 1 回の推論の出力は 128 KiB 以内（作品の上限と同じ）。
- **C の推論**：1 ターン最大 3 回（`callsLeft`）。契約違反の出力の直し（correction）も 1 回に数える。
- **P の推論**：Pursuit の推論（plan・hypothesize・propose・review）は作品の提出とは別に数え、追加費用として報告する。policy は `eval/p3/policy.p3.json`（1 ターン：試行 12・仮説ごと 3・仮説 3/方針・方針 2・巻き戻し 3・遷移 120）。相談には固定文「利用者は不在です。依頼文と観測の範囲で判断してください。」で答える（3 回を超えたら停止）。
- **時間**：plan.md §3.2 の 1 課題 180 秒は、代行の応答者（人間に近い速度で考えるエージェント）には当てはめられない。応答者の待ち時間は除いて、ホスト側の時間（契約検査・観測・保存・Pursuit の台帳処理）を測る。実モデルの推論時間は **未測定**。
- 結果不明・未完了・上限超過は不合格。

## 条件 C の接続（Collaborator の公開契約への対応）

| TurnContext | 値 |
| --- | --- |
| system | `collaborationInstructions.rules`＋出力 schema（`createCollaborationContract(policy).outputSchema`）＋ TOOLS（`artwork.propose` の説明と引数 schema） |
| utterance | 利用者の依頼（このターン） |
| course | これまでのターン（依頼・返答・`artwork.propose` の結果と版） |
| work | label＝作品の題名（新規は「新しい作品」）、dirty＝false、savedRef＝保存版の参照、context＝公開契約の本文と登録データの説明 |
| document | 基準作品があるとき：path `artwork.js`、revision＝保存版、body＝作品の本文、rejected＝直前に検査に落ちた案（issues＝契約違反・観測の種類、fixes＝観測の文） |
| callsLeft | このターンに残る推論の回数 |

- 応答は `createCollaborationContract(...).check` で検査する。invoke 以外（reply・return・discard）は作品を出さないので、そのターンは候補なしで終わる（不合格）。
- **契約にない部分（ギャップとして記録）**：TOOLS と TOOL_RESULT の書式は collaboration の core に無く、Eumenes 本体の担当実行側にある。本体を使わない指示のため、canvas 側の adapter が JSON で組む（`TOOLS=` と `TOOL_RESULT=`）。ReplyPolicy の値（最大文字数・文数）も host 側の値で、collaboration の example/host.ts と同じ 300 字・2 文とする。system の組み方（rules＋文書改訂の注意＋OUTPUT_SCHEMA、invoke の arguments に引数 schema を差し込む）も example/host.ts の `propose` に合わせる。

## 条件 P の接続（Pursuit の host 契約への対応）

| port | canvas 側の実装 |
| --- | --- |
| `PursuitStore` | bun:sqlite（一時ファイル）。`migrations` を順に適用し、`write` は BEGIN IMMEDIATE の transaction |
| `ToolPort` | `write_artwork`（作業領域、text field＝作品の本文、入力 title。契約検査とホスト観測を行い、その結果を返す。1 ターン 3 回まで）、`read_artwork`（読むだけ、readsBack） |
| `WorkspacePort` | 作業領域は作品の本文と題名だけ。checkpoint・restore・digest・変更の特徴量をメモリ上で計算する |
| `AcceptancePort` | 受入条件は 3 つ（contract・loaded・operated）。ホスト観測（host-smoke/1）の結果をそのまま返す。**隠れた判定は使わない**（D・C と同じ観測しか与えないため） |
| `LlmPort` | ファイル応答（generator と reviewer は別のディレクトリ・別の応答者） |
| `JudgePort` | なし（LARM はこの環境に無い）。conditions は Pursuit 自身の評価で LARM 無しに使う **E1R**（rules＋review、judge なし） |

- conditions：findings verified、selfCheck parts、verifyOn claim、prediction falsifiable、completionCheck acceptance、claimFeedback verdict、attemptCount mutating（Pursuit の ablation-1 と同じ）。
- 目標文：依頼・これまでの会話・基準作品の本文・公開契約・データの説明を、それぞれ見出し付きで渡す。
- Pursuit が終わったら、作業領域の最後の作品を製品の制作経路（CanvasService）に初回の候補として渡し、同じ検査・観測・保存を通す。ここで落ちた場合の修正は行わない（提出の上限を Pursuit の中で使い切っているため）。
- **ギャップ**：`stepWithDeadline` は standalone 側にあり公開入口に無い。ホストが AbortSignal で期限を管理する。

## 測るもの

- 課題群（新規・部分修正・修復・非ゲーム、ゲーム計）ごとの合格数と plan.md §4 の基準（群 10/12、ゲーム計 32/36、課題ごと 2/3、非ゲーム 2/3）。
- 合格までの提出回数、ホスト側時間の P50・P90（応答者の待ちを除く）。
- 推論回数と、トークンの代わりの文字数（要求の system＋prompt と応答の文字数。トークンは文字数÷4 の推定で、3 条件で同じ式）。D に対する追加分。
- 「ホスト観測に通ったが判定に落ちた」試行（P2 の N1・N3 型）の件数と内容。
- 平均を条件・課題群をまたいで混ぜない。

## 実行の手順

1. `eval/p3/setup-deps.sh`（固定した版を展開して依存を入れる）。`bun run p3:typecheck` で接続部の型を確かめる。
2. `eval/p3/make-runs.sh /workspace/canvas_p3`：`{D,C,P}-r{1,2,3}` の 9 個の実行ディレクトリを作る。各ディレクトリに `RUN_NAME`・`PORT`（4701 から 2 つおき）・`READY.txt`（制作担当の説明と立入禁止の範囲。P は `READY-rev.txt` も）・`tools/`（`eval/p3/responder/` の写し）・`work/`。
3. `eval/p3/start-runs.sh /workspace/canvas_p3`：9 個の実行器（`bun eval/p3/run.ts --cond <c> --run-dir <dir> --host-port <port>`）をバックグラウンドで起動する。ログは `/workspace/canvas_p3/logs/`（実行ディレクトリの外）。止まっても、終わった課題を飛ばして再開できる。
4. 実行ディレクトリごとに、新しい会話の制作担当を 1 人（P は検証担当も 1 人）割り当て、`READY.txt` だけを渡す。担当は `tools/show.sh` で要求を読み、条件ごとの道具（D: `art.sh`、C: `invoke.sh`・`fill.sh`、P: `ptool.sh`・`fill.sh`、共通: `write.sh`）で答える。`host/DONE` ができたら終了。
5. 全条件・全反復の制作が終わってから `bun eval/p3/grade.ts --root /workspace/canvas_p3`（判定 v1 正式・N3 だけ v2 参考。結果は `grade/grades.json`）と `bun eval/p3/aggregate.ts --root /workspace/canvas_p3 --out docs/eval/p3-summary.json`。

応答の道具は、形の検査に落ちた応答を理由つきで同じ要求に戻す（`-retry<k>`、最大 2 回。3 条件で同じ）。形の空欄を埋める `fill.sh` は、出力の形の必須項目を空の値で埋めるだけで、中身は作らない。

## 凍結後の変更

制作を始める前（採点の記録が 1 件も無い時点）の変更だけ。

- 条件 C：ReplyPolicy を 400 字・4 文から、collaboration の example/host.ts と同じ 300 字・2 文に直した（契約に無い値を自分で決めないため）。
- 条件 C：`document.revision` を、会話の版番号ではなくその担当の会話の中で数える番号にした。会話の版番号を使うと、最後の会話の版と文書の版が食い違い、利用者が画面で変更したことになる誤り（`changedOnScreen: true`）が出たため。乾式の確認で見つけた。
- 実行の手順に、実行ディレクトリの作成・起動・応答の道具を書き足した。
