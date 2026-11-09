import { afterAll, expect, test } from "bun:test";
import { startApp } from "../../src/server/app";

// "localhost" が ::1 だけに解決されても、ブラウザが IPv4・IPv6 のどちらで接続しても届くこと
const app = startApp({ hostPort: 4340, previewPort: 4341, devHarness: true });
afterAll(() => app.stop());

test("ホストは 127.0.0.1 と ::1 の両方で接続を受け、origin は localhost のまま", async () => {
  for (const addr of ["127.0.0.1", "[::1]"]) {
    const r = await fetch(`http://${addr}:4340/api/config`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ hostOrigin: "http://localhost:4340", previewOrigin: "http://127.0.0.1:4341" });
    const html = await fetch(`http://${addr}:4340/harness.html`);
    expect(html.status).toBe(200);
    await html.text();
    // 変更系は http://localhost:<port> からの要求だけを受ける
    const bad = await fetch(`http://${addr}:4340/api/dev/preview`, { method: "POST", headers: { origin: `http://${addr}:4340`, "content-type": "application/json" }, body: "{}" });
    expect(bad.status).toBe(403);
    const ok = await fetch(`http://${addr}:4340/api/dev/preview`, { method: "POST", headers: { origin: "http://localhost:4340", "content-type": "application/json" }, body: JSON.stringify({ title: "t", entry: "canvasApp.start(() => ({ frame() {} }));" }) });
    expect(ok.status).toBe(200);
  }
});

test("プレビューは 127.0.0.1 だけで待ち受ける（別サイトのまま）", async () => {
  expect((await fetch("http://127.0.0.1:4341/shell.html")).status).toBe(200);
  await expect(fetch("http://[::1]:4341/shell.html")).rejects.toThrow();
});
