// 制作手順（docs/maker-skill.md）と公開契約の明示（P3 の改善）。直接生成の system が手順の文書を読むこと。
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadMakerSkill, parseMakerSkill } from "../../src/core/maker-skill";
import { DIRECT_PREAMBLE, DIRECT_SYSTEM, DIRECT_SYSTEM_P3, DirectModel, directSystem } from "../../eval/p3/cond-d";
import { ROOT } from "./support";

const SKILL_TEXT = readFileSync(join(ROOT, "docs/maker-skill.md"), "utf8");
const CONTRACT = readFileSync(join(ROOT, "docs/artwork-contract-v1.md"), "utf8");

test("制作手順は SKILL 形式（frontmatter の name・description と、決まった節）", () => {
  const s = loadMakerSkill();
  expect(s.name).toBe("canvas-artwork-maker");
  expect(s.description.length).toBeGreaterThan(20);
  for (const h of ["## 目的", "## モード", "## 必須原則", "## 情報・道具の安全性", "## 標準の流れ", "## 完成条件"]) expect(s.body).toContain(h);
  for (const m of ["Create", "Modify", "Repair"]) expect(s.body).toContain(m);
  expect(() => parseMakerSkill("本文だけ")).toThrow();
  expect(() => parseMakerSkill("---\nname: x\n---\n本文")).toThrow();
});

test("制作手順の必須原則：dt<=0・start 1 回・code と key・依頼箇所だけ・終了画面・観測と依頼の区別・合わせ込みの禁止", () => {
  const b = loadMakerSkill().body;
  for (const k of ["`dt <= 0` では物理を進めない", "`canvasApp.start` は 1 回だけ", "`code` と `key` の両方", "変更は依頼された箇所だけ", "終了画面に文字や得点を残す", "ホスト観測の合格を依頼の達成と混ぜない", "観測器に合わせ込まない", "シミュレーション", "長い計画を足さない"]) expect(b).toContain(k);
});

test("制作手順・system には観測器の固定点（格子）の座標や数を書かない、評価のメタデータも書かない", () => {
  for (const text of [SKILL_TEXT, DIRECT_SYSTEM, CONTRACT]) {
    expect(text).not.toMatch(/6\s*[×x]\s*4/);
    expect(text).not.toMatch(/40\s*\+\s*\w*\s*\*?\s*80/);
    expect(text).not.toContain("格子");
    expect(text).not.toMatch(/host-smoke/);
  }
  for (const k of ["P3", "heldout", "general-v1", "eval/", "commit"]) expect(SKILL_TEXT).not.toContain(k);
});

test("直接生成の system は前置き＋docs/maker-skill.md の本文（文書を変えれば system も変わる）", () => {
  const s = loadMakerSkill();
  expect(DIRECT_SYSTEM.startsWith(DIRECT_PREAMBLE)).toBe(true);
  expect(DIRECT_SYSTEM).toContain(s.body);
  expect(DIRECT_SYSTEM).not.toContain("description:");
  const other = directSystem(parseMakerSkill("---\nname: probe\ndescription: 試験用の手順の説明です\n---\n# 試験\n独自の規則 XYZ"));
  expect(other).toContain("独自の規則 XYZ");
  expect(other).not.toContain(s.body);
  expect(DIRECT_SYSTEM_P3).not.toContain(s.body); // P3 の記録用の文は変えない
});

test("DirectModel は推論の system に手順入りの文を渡す", async () => {
  const seen: { system: string; prompt: string }[] = [];
  const ch = {
    async complete(req: { system: string; prompt: string }) {
      seen.push(req);
      return { body: { title: "t", entry: "canvasApp.start(() => ({}))" }, changes: "", unconfirmed: [], reply: "" };
    },
  };
  const m = new DirectModel(ch as never);
  await m.generate({ request: "作って", conversation: [], base: null, baseDigest: null, contract: CONTRACT, datasets: [], attempt: 0, previous: null, previousDigest: null, observations: [] }, new AbortController().signal);
  expect(seen[0].system).toBe(DIRECT_SYSTEM);
  expect(seen[0].system).toContain("`dt <= 0` では物理を進めない");
  expect(seen[0].prompt).toContain("dt = 0");
});

test("公開契約：入力時の frame(t, 0)、dt<=0 の扱い、start 1 回、code と key、観測と依頼、終了画面、間隔、最初の出現", () => {
  for (const k of ["**`dt = 0`** でも呼ばれる", "`dt <= 0` のときは", "if (dt > 0) update", "`canvasApp.start` は作品全体で 1 回だけ", '`ev.code === "Space" || ev.key === " "`', "観測の合格は依頼どおりに動くことの証明ではない", "単色だけにしない", "ピッチ", "最初の 1 個は起動直後に出し"]) expect(CONTRACT).toContain(k);
  expect(CONTRACT).toContain("版は `canvas-artwork/1`");
});

test("契約に書いた frame(t, 0) は実装どおり：ブートストラップは pointermove 以外の入力・リサイズ・起動で frame(0) を呼ぶ", () => {
  const boot = readFileSync(join(ROOT, "src/preview/bootstrap.js"), "utf8");
  expect(boot).toMatch(/m\.type === "input"\) \{\s*call\("input", \[m\.ev\]\);\s*if \(m\.ev && m\.ev\.type !== "pointermove"\) \{ frame\(0\); present\(\); \}/);
  // 起動・入力・リサイズ・HTML の復号の完了・復号を待った起動の完了（docs/artwork-contract-v1.md「HTML の描画」）・観測用の時間を進めない描き直し（poke）
  expect(boot.match(/frame\(0\);/g)!.length).toBe(6);
});
