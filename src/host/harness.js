// 試験用ハーネス（ホストオリジン）。作品を登録して共通プレビューで動かす。
import { PreviewController } from "/preview-client.js";

const cfg = await (await fetch("/api/config")).json();
const events = [];
const ctl = new PreviewController(document.getElementById("frame"), {
  previewOrigin: cfg.previewOrigin,
  onEvent: (m) => events.push({ ...m, at: performance.now() }),
});
await ctl.mount();
let clicks = 0;
document.getElementById("probe-button").addEventListener("click", () => {
  clicks++;
  document.getElementById("probe-count").textContent = String(clicks);
});

window.harness = {
  events,
  async start({ entry, title = "probe", data = null, seed = 1, clock = "manual" }) {
    const r = await fetch("/api/dev/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, entry }) });
    const j = await r.json();
    if (!r.ok) return { type: "rejected", errors: j.errors };
    return ctl.start({ token: j.token, data, seed, clock });
  },
  advance: (ms) => ctl.advance(ms),
  stop: () => ctl.stop(),
  focus: () => ctl.focus(),
  setNarrow(on) {
    document.getElementById("frame").classList.toggle("narrow", on);
  },
  dropped: () => ctl.dropped,
  readyCount: () => ctl.readyCount,
};
document.title = "ready";
