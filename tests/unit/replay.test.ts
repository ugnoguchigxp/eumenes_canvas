import { expect, test } from "bun:test";
import { chromium } from "@playwright/test";
import { HostReviewer } from "../../src/core/host-reviewer";
import type { InferenceChannel } from "../../src/core/inference";
import { PlaywrightObserver } from "../../src/core/observer";
import { PlaywrightProber } from "../../src/core/probes";
import { PromptEvaluator } from "../../src/core/prompt-evaluator";
import { PromptMaker } from "../../src/core/prompt-maker";
import { CanvasService } from "../../src/core/service";
import { Store } from "../../src/core/store";
import { startCanvasApp } from "../../src/server/canvas-app";

const script = { requirement: "R1", purpose: "Space で横に40px動く", steps: [
  { do: "track", color: "#00ff00", label: "入力前" },
  { do: "tap", input: "Space" },
  { do: "track", color: "#00ff00", label: "入力後" },
] };
const entry = (dx: number) => `canvasApp.start(api => {
  let x=40;
  return {
    frame(){api.ctx.fillStyle="#000000";api.ctx.fillRect(0,0,api.width,api.height);api.ctx.fillStyle="#00ff00";api.ctx.fillRect(x,100,20,20)},
    input(e){if(e.type==="keydown"&&e.code==="Space")x+=${dx}}
  };
});`;

test("同じ操作で修正前後を Chromium で測り、独立判定は1回", async () => {
  let generated = 0;
  let judgments = 0;
  const maker: InferenceChannel = {
    async complete(req, validate) {
      const initial = generated++ === 0;
      const schema = req.outputSchema as { properties: Record<string, unknown> };
      expect("replay" in schema.properties).toBe(initial);
      const raw = {
        title: "操作の再生", entry: entry(initial ? 10 : 40), changes: "", unconfirmed: [], reply: "",
        spec: { requirements: ["Space で横に40px動く"], controls: [] },
        ...(initial ? { replay: script } : {}),
      };
      const r = validate(raw);
      if (!r.ok) throw new Error(JSON.stringify(r.issues));
      return r.value;
    },
  };
  const evaluator: InferenceChannel = {
    async complete(req, validate, _signal, retries) {
      judgments++;
      expect(req.purpose).toBe("eval-judge");
      expect(retries).toBe(0);
      expect(req.prompt).toContain("中心(59.5,109.5)");
      const r = validate({ verdicts: [{ requirement: "R1", verdict: "fail", evidence: ["S1-2"], note: "10pxしか動かない" }], issues: [], summary: "" });
      if (!r.ok) throw new Error(JSON.stringify(r.issues));
      return r.value;
    },
  };
  const app = startCanvasApp({
    hostPort: 4918, previewPort: 4919, devHarness: true, singleUser: true,
    makeService: ({ hostOrigin, tokens, singleUser }) => {
      const issue = (body: Parameters<typeof tokens.issue>[0]) => tokens.issue(body);
      return new CanvasService({
        store: new Store(null), model: new PromptMaker(maker), observer: new PlaywrightObserver(hostOrigin, issue), contract: "公開実行契約", singleUser,
        review: { mode: "replay", reviewer: new HostReviewer(new PlaywrightProber(hostOrigin, issue), new PromptEvaluator(evaluator)) },
      });
    },
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(app.hostOrigin + "/?clock=manual");
    await page.locator('body[data-ready="1"]').waitFor();
    await page.locator("#message").fill("Space で横に40px動く緑の四角");
    const started = page.waitForResponse((r) => r.url().endsWith("/api/runs") && r.status() === 201);
    await page.locator("#send").click();
    const { id } = await (await started).json();
    await page.locator("#cand-review-head", { hasText: "修正後の操作を再生・要件の合否は未確認" }).waitFor();
    expect(await page.locator("#cand-findings").textContent()).toContain("修正前");
    expect(await page.locator("#cand-findings").textContent()).toContain("修正後");
    const run = app.service.getRun("local", id);
    expect(generated).toBe(2);
    expect(judgments).toBe(1);
    const [first, second] = run.candidates;
    const before = first.review!.replay!;
    const after = second.review!.replay!;
    expect(before.phase).toBe("initial");
    expect(after.phase).toBe("repair");
    expect(after.plan).toEqual(before.plan);
    expect(before.results[0].measures[1].text).toContain("中心(59.5,109.5)");
    expect(after.results[0].measures[1].text).toContain("中心(89.5,109.5)");
    expect(second.review?.verdict).toBeNull();
    expect(second.review?.evaluatorCalls).toBe(0);
    expect(run.presentedCandidateId).toBe(second.id);
  } finally {
    await browser.close();
    await app.service.close();
    app.stop();
  }
}, 35_000);
