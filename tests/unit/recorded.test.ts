import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GenerationInput } from "../../src/core/model-port";
import { RecordedProvider } from "../../src/core/recorded-provider";

const input: GenerationInput = { request: "作って", conversation: [], base: null, baseDigest: null, contract: "", datasets: [], attempt: 0, previous: null, previousDigest: null, observations: [] };

test("記録済み推論は sample ごとに別の記録を返し、無い sample はエラーにする", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rec-"));
  try {
    writeFileSync(join(dir, "a.js"), "canvasApp.start(() => ({ frame() {} })); // a");
    writeFileSync(join(dir, "b.js"), "canvasApp.start(() => ({ frame() {} })); // b");
    const out = (f: string) => ({ title: "t", entryFile: f, changes: "", unconfirmed: [], reply: "" });
    writeFileSync(join(dir, "r.json"), JSON.stringify({ author: "test", recordings: [
      { input: { request: "作って", conversation: [], attempt: 0 }, output: out("a.js") },
      { input: { request: "作って", conversation: [], attempt: 0 }, sample: 1, output: out("b.js") },
    ] }));
    const p = new RecordedProvider([join(dir, "r.json")]);
    const sig = new AbortController().signal;
    expect((await p.generate(input, sig)).body.entry).toContain("// a");
    p.sample = 1;
    expect((await p.generate(input, sig)).body.entry).toContain("// b");
    p.sample = 2;
    await expect(p.generate(input, sig)).rejects.toThrow("記録にない入力");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
