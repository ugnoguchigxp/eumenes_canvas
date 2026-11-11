// 06：制作担当のプロンプト・出力の形・応答の検査（src/core/prompt-maker.ts）。
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { InferenceChannel, InferenceRequest, Validate } from "../../src/core/inference";
import { loadMakerSkill } from "../../src/core/maker-skill";
import type { GenerationInput } from "../../src/core/model-port";
import { MAKER_PITFALLS_PATH, MAKER_PREAMBLE, makerPrompt, makerSystem, PromptMaker, validateMakerOutput } from "../../src/core/prompt-maker";
import { ROOT } from "./support";

const input = (o: Partial<GenerationInput> = {}): GenerationInput => ({
  request: "Space で跳ぶ四角",
  conversation: [],
  base: null,
  baseDigest: null,
  contract: "CONTRACT-TEXT",
  datasets: [],
  attempt: 0,
  previous: null,
  previousDigest: null,
  observations: [],
  ...o,
});
const prev = { title: "前", entry: "canvasApp.start(() => ({}));" };
const good = { title: "跳ぶ", spec: { requirements: ["Space で跳ぶ"], controls: [{ kind: "key", input: "Space", action: "ジャンプ", always: true }] }, entry: "canvasApp.start(() => ({}));", changes: "新規", unconfirmed: [], reply: "作りました" };

describe("制作担当の system", () => {
  test("system の並び", () => {
    const s = makerSystem();
    expect(s.startsWith(MAKER_PREAMBLE)).toBe(true);
    expect(s).toContain(loadMakerSkill().body);
    expect(s).toContain("# 作品づくりの落とし穴");
    expect(s.indexOf("# 制作手順")).toBeGreaterThan(-1);
    expect(s.indexOf("# 制作手順")).toBeLessThan(s.indexOf("# 作品づくりの落とし穴"));
  });
  test("書いてはいけないもの", () => {
    const pitfalls = readFileSync(MAKER_PITFALLS_PATH, "utf8");
    expect(MAKER_PITFALLS_PATH).toBe(join(ROOT, "docs/maker-pitfalls.md"));
    for (const text of [makerSystem(), pitfalls]) for (const k of ["格子", "host-smoke", "host-probe", "heldout", "general-v1", "eval/", "commit"]) expect(text).not.toContain(k);
  });
});

describe("制作担当のプロンプト", () => {
  test("新規のプロンプト", () => {
    expect(makerPrompt(input())).toBe("## 依頼\nSpace で跳ぶ四角\n\n## 基準の作品\nなし（新規）\n\n## 登録データ\nなし\n\n## 公開された実行契約\nCONTRACT-TEXT");
  });
  test("以前の変更を維持するときは選択中の保存版のコードを基準にする", () => {
    const p = makerPrompt(input({
      request: "円の色を元に戻して。点滅の間隔は半分のまま。",
      conversation: [{ role: "user", text: "点滅の間隔を今の半分にして、円を青にして。" }],
      base: { title: "円", entry: 'const interval = 400, color = "blue";' },
    }));
    expect(p).toContain("以前の依頼ですでに適用した増減を重ねて適用しません。\n題名: 円");
    expect(p).toContain('const interval = 400, color = "blue";');
  });
  test("必須の検査に落ちた直し", () => {
    const p = makerPrompt(input({ attempt: 1, previous: prev, observations: [{ kind: "runtime-error", message: "frame: boom" }] }));
    expect(p).toContain("## 前の候補（試行 1 回目の前。ホスト観測に通らなかった）");
    expect(p).toContain("## ホスト観測（前の候補）\n- runtime-error: frame: boom");
  });
  test("検証の指摘による直し", () => {
    const p = makerPrompt(input({ attempt: 1, previous: prev, previousPassed: true, observations: [{ kind: "probe", message: "[要修正] Space が効かない" } as any] }));
    expect(p).toContain("ホストの必須の検査には通ったが、検証で指摘があった");
    expect(p).toContain("## 検証の指摘（前の候補）\n「要修正」はすべて直し");
    expect(p).toContain("- probe: [要修正] Space が効かない");
    expect(p).not.toContain("ホスト観測に通らなかった");
  });
  test("観測が 0 件なら（文なし）", () => {
    expect(makerPrompt(input({ attempt: 1, previous: prev }))).toContain("## ホスト観測（前の候補）\n- （文なし）");
  });
});

describe("応答の検査と PromptMaker", () => {
  test("応答の検査", () => {
    const r = validateMakerOutput(good);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.spec).toBe(good.spec);
      expect(r.value.body).toEqual({ title: "跳ぶ", entry: good.entry });
    }
    const { spec, ...noSpec } = good;
    expect(validateMakerOutput(noSpec).ok).toBe(false);
    expect(validateMakerOutput({ ...good, spec: { requirements: [], controls: [] } }).ok).toBe(false);
    expect(validateMakerOutput({ ...good, spec: { requirements: ["  "], controls: [] } }).ok).toBe(false);
    expect(validateMakerOutput({ ...good, extra: 1 }).ok).toBe(false);
    const withLibs = validateMakerOutput({ ...good, libraries: ["three@0.187.0"] });
    expect(withLibs.ok && withLibs.value.body.libraries).toEqual(["three@0.187.0"]);
  });
  test("PromptMaker", async () => {
    const seen: InferenceRequest[] = [];
    let reply: unknown = good;
    const ch: InferenceChannel = {
      async complete<T>(req: InferenceRequest, validate: Validate<T>): Promise<T> {
        seen.push(req);
        const v = validate(reply);
        if (!v.ok) throw new Error("形が違う: " + JSON.stringify(v.issues));
        return v.value;
      },
    };
    const m = new PromptMaker(ch);
    expect(m.label).toBe("prompt-maker");
    const out = await m.generate(input(), new AbortController().signal);
    expect(out.body.title).toBe("跳ぶ");
    expect(seen[0].purpose).toBe("maker");
    expect(seen[0].system).toBe(makerSystem());
    expect(seen[0].prompt).toBe(makerPrompt(input()));
    reply = { title: "x" };
    await expect(m.generate(input(), new AbortController().signal)).rejects.toThrow();
  });
});
