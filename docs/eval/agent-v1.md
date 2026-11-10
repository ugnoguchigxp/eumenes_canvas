# 条件 A（宣言つきの制作担当＋検証）agent-v1 の実行条件の凍結記録

2026-11-10 作成（[docs/agent-plan/09-eval-and-models.md](../agent-plan/09-eval-and-models.md)）。**代行の応答（Grok Bot の応答者）であり、実モデルの結果ではない。** この文書の条件で生成ランを始めた後に、手順書・観測の規則・落とし穴の付録・数え方を変えたら、agent-v2 として別に扱い、v1 の結果と混ぜない（結果を見たあとで変えた場合も同じ）。

**状態：** 実行条件の凍結だけ。生成ランは未実施（応答者の割り当てと実行の開始は利用者の了解を得てから。合格率・指標はすべて未測定）。

## 課題と判定（既存のまま変えない）

- 課題は **render-v1**（[凍結記録](render-v1.md)、`eval/tasks/render.json`、6 課題）と **general-v1**（[凍結記録](general-v1.md)、`eval/tasks/general.json`、10 課題）。課題文・元作品・判定（`eval/checks/*.ts`）・参照の作品（`eval/gold/`）は変えない。条件 D（直接生成、`eval/p3/cond-d.ts`）と同じ判定で比べる。
- 1 課題 3 回（実行ディレクトリ `A-r1`〜`A-r3`）。合格の定義は各凍結記録と同じ（全ターンで候補が提示・保存され、保存された最終版が判定のすべての観点に合格）。

## 条件 A の構成

| 部分 | 中身 |
| --- | --- |
| 制作担当 | `PromptMaker`（`src/core/prompt-maker.ts`、label `agent-maker(stand-in)`）。system は前置き＋`docs/maker-skill.md`＋`docs/maker-pitfalls.md`。出力に宣言 `spec`（要件と操作）を含む |
| 検証 | `HostReviewer`（`src/core/host-reviewer.ts`）。観測は `PlaywrightProber`（host-probe/1）。`--review probes` は観測だけ、`judge` は観測＋検証担当の判定 1 回、`full` は観測＋検証担当の台本と判定 |
| 検証担当 | `--review judge・full` のとき `PromptEvaluator`（`src/core/prompt-evaluator.ts`、label `agent-evaluator(stand-in)`）。system は前置き＋`docs/evaluator-skill.md`。応答は `solo/eval` のファイル応答（制作担当とは別の応答者） |
| 制作のループ | `CanvasService` の検証つきの制作のループ（08）。重い指摘があり試行が残っていれば直させる。提示は重い指摘が最も少ない候補（同数なら後） |
| 前処理 | 元作品を版 1 にする前処理（`SeedingModel`）では検証しない（`SeedSkippingReviewer`） |

実行：`bash eval/p3/make-runs.sh <root> A` → 応答者を割り当て（`READY-gen.txt`・`READY-eval.txt`）→ `SUITE=<render|general> bash eval/p3/start-runs.sh <root> A <probes|judge|full>` → 全反復の DONE のあと `bun eval/<render|general>/grade.ts --root <root>`。

## 上限

- 制作担当：1 ターン 3 回（初回＋修正 2 回）、1 課題 6 回まで（plan.md §3.2、条件 D と同じ）。
- 検証担当：別枠で数える。1 候補につき最大 2 回（台本・判定）、1 ターン最大 6 回。検証の回数は 1 ターン最大 3 候補。
- 台本：6 本まで、1 本 30 手順・待ち 30 秒・測定 12 個まで。台本全体の実時間 30 秒まで（`PROBE.scriptBudgetMs`）。
- 実行の期限は `RUN_TIMEOUT_MS`（6 時間、応答者の待ちを含む）。期限までの残りが 45 秒より短いときは検証を始めない。

## 数え方

- **合格**：判定の合否（条件 D と同じ）。条件（D・A）をまたいで足さない。課題群（新規・変更・修復・可視化）もまたいで混ぜない。
- **presentedButFailed**：提示・保存まで進んだのに判定で不合格だった件数。
- **evaluator.agreement**：`finalReview`（最後に保存した候補の検証の要約）がある試行で、「重い指摘 0 件」を合格の予想として判定と突き合わせた `{ bothPass, bothFail, missed, falseAlarm }`。
- **calls**：制作担当・検証担当それぞれの推論の合計と中央値（形の違う応答の出し直しも 1 回と数える）。
- **hostMs**：合格した試行の P50・P90（最近順位法）。制作担当と検証担当の両方の待ち時間を引いた、ホスト側の時間。

## 採否の目安（事前に決める、09 §6）

| 見る数字 | 採る | 採らない |
| --- | --- | --- |
| 観測（`probes`） | 自己確認で偽陽性 0。条件 D に比べて `presentedButFailed` が減る、または同じで `hostMs` の P90 の増え方が 10 秒以内 | 偽陽性が直せない |
| 検証担当（`full`） | `probes` に比べて合格が増える、または `presentedButFailed` が減る。`missed` と `falseAlarm` の合計が、突き合わせた試行の 2 割以下 | 合格が増えず、推論が 2 倍以上になるだけ |

## 文書の digest（sha256、凍結時）

| 文書 | digest |
| --- | --- |
| `docs/artwork-contract-v1.md` | `929865cf4e2082baeeb7497784d5c7e224d3966daddd73ebd4380ede7ef7b0d8` |
| `docs/maker-skill.md` | `3c2ada18ae7690d93bba2f3305751c36a64495382dd6240c6c7097ac1cdaa98a` |
| `docs/evaluator-skill.md` | `e7c01256a3e0c9832710a4ce5074b1f617e4aedb373852de2533e3a95bcde196` |
| `docs/maker-pitfalls.md` | `f9165cab47c104d3907d11257219b98b52c8eb0f6d3de4461554707b0e04cd68` |

実行器は各実行の `host/run.json` に、`cond`・`review`・`probe`（host-probe/1）と、上の 4 つの digest を記録する。凍結時と違う digest の実行は v1 に数えない。

## 性質の観測の自己確認（09 §3）

`bun eval/agent/probe-self-test.ts`（推論なし）。結果は [probe-v1-self-test.json](probe-v1-self-test.json)。2026-11-10、headless Chromium で **期待と違う作品 0 件**（23 件：P1 の固定作品 3・デモのゲーム 4・general-v1 の参照の作品 8・描画のデモ 5 で重い指摘 0 件、壊れた対照 1・dt = 0 の対照 1 は期待どおり見つかり、正しい対照 1 は指摘なし）。規則も期待も変えていない。参考の指摘は G-N4-turret の `P-long`（info）1 件。描画のデモ 5 件は描画が重いため長時間の観測が省かれ、一部はクリック・リサイズも時間の上限で省かれた（省いた観測は指摘を出さない）。
