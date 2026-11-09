// 送信すると、ホスト画面の診断イベントが client.log に、要求が server.log に残る（依頼の本文は残らない）。
import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openHost, ask, waitCandidate } from "./support/host";
import { e2eDataDir } from "./support/paths";

const LOGS = join(e2eDataDir(4310), "logs");
const read = (f: string) => (existsSync(join(LOGS, f)) ? readFileSync(join(LOGS, f), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

test("送信で client.log と server.log に記録が残る", async ({ page }) => {
  test.setTimeout(90_000);
  await openHost(page);
  const text = `落ち物ゲームを作って`;
  await ask(page, text);
  await waitCandidate(page);

  // 複数の画面が同じサーバーに書くため、この画面の page id に絞る
  const id = await page.evaluate(() => (window as any).__canvasLogPage);
  const mine = () => read("client.log").filter((e) => e.page === id);
  await expect
    .poll(() => {
      const c = mine();
      // 送信はおよそ 2 秒ごとにまとめて届く
      return ["page.boot", "config", "page.ready", "ui.click", "ui.submit.capture", "ui.submit", "run.state", "preview.connection", "preview.start"].every((t) => c.some((e) => e.type === t));
    }, { timeout: 10_000 })
    .toBe(true);
  const c = mine();
  const submit = c.filter((e) => e.type === "ui.submit").at(-1);
  expect(submit.length).toBe(text.length);
  expect(c.some((e) => e.type === "ui.click" && e.id === "send" && e.appReady === true)).toBe(true);
  expect(c.some((e) => e.type === "run.state" && e.state === "presented")).toBe(true);
  expect(c.some((e) => e.type === "api.end" && e.path === "/api/runs" && e.method === "POST" && e.status === 201)).toBe(true);
  expect(c.some((e) => e.type === "preview.start" && e.result === "ready")).toBe(true);
  expect(c.some((e) => e.type === "page.boot" && String(e.ua).length > 0)).toBe(true);

  const s = read("server.log");
  expect(s.some((e) => e.server === "host" && e.method === "POST" && e.path === "/api/runs" && e.status === 201 && e.origin === "http://localhost:4310")).toBe(true);
  expect(s.some((e) => e.server === "host" && e.path === "/api/client-log" && e.status === 204)).toBe(true);
  expect(s.some((e) => e.server === "preview" && e.path === "/shell.html" && e.status === 200)).toBe(true);
  expect(s.some((e) => e.server === "preview" && e.path === "/w/[token]" && e.status === 200)).toBe(true);

  // 依頼の本文は、どちらのログにも残らない
  const raw = readFileSync(join(LOGS, "client.log"), "utf8") + readFileSync(join(LOGS, "server.log"), "utf8");
  expect(raw).not.toContain(text);
});

test("画面を離れるときに残りのイベントを送り切る（pagehide）", async ({ page }) => {
  await openHost(page);
  const id = await page.evaluate(() => (window as any).__canvasLogPage);
  await page.waitForTimeout(2500); // 起動時のイベントを先に送り切る
  await page.locator("#message").press("Enter"); // 修飾キーなしの Enter は改行になり送信しない
  await page.goto("about:blank");
  await expect
    .poll(() => {
      const c = read("client.log");
      return c.some((e) => e.page === id && e.type === "ui.enter" && e.meta === false && e.ctrl === false);
    }, { timeout: 10_000 })
    .toBe(true);
});

test("app.js が動かなくても、送信の押下でページは読み直されず、押下が記録に残る", async ({ page }) => {
  await page.route("**/app.js", (route) => route.abort("blockedbyclient"));
  await page.goto("/");
  const id = await page.evaluate(() => (window as any).__canvasLogPage);
  await page.locator("#message").fill("試しの依頼");
  await page.locator("#send").click();
  await page.waitForTimeout(300);
  expect(new URL(page.url()).search).toBe("");
  await expect(page.locator("#message")).toHaveValue("試しの依頼");
  await expect
    .poll(() => read("client.log").some((e) => e.page === id && e.type === "ui.submit.capture" && e.appReady === false), { timeout: 10_000 })
    .toBe(true);
  expect(read("client.log").some((e) => e.page === id && e.type === "ui.click" && e.id === "send" && e.appReady === false)).toBe(true);
});
