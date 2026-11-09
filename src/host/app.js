// 検証ホストの画面。会話・作品一覧・プレビュー・3 表示モード・候補の保存と復元。
import { PreviewController } from "/preview-client.js";

const $ = (id) => document.getElementById(id);
const cfg = await (await fetch("/api/config")).json();

function rid(n = 12) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
// 制作画面ごとの session（タブごと）
// 試験では ?clock=manual で時計をホストから進める
const CLOCK = new URLSearchParams(location.search).get("clock") === "manual" ? "manual" : "raf";
const session = sessionStorage.getItem("canvas-session") || rid();
sessionStorage.setItem("canvas-session", session);

const state = {
  artworkId: null,
  currentRevision: 0,
  conversation: [],
  runId: null,
  candidate: null,
  saveKey: null,
  previewSource: null,
  mode: "frame",
  returnFocus: null,
};

async function api(path, { method = "GET", body } = {}) {
  const r = await fetch(path, {
    method,
    headers: { "content-type": "application/json", "x-canvas-session": session },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j.error || r.statusText);
    e.status = r.status;
    e.info = j;
    throw e;
  }
  return j;
}

const host = $("preview-host");
const ctl = new PreviewController($("preview-frame"), {
  previewOrigin: cfg.previewOrigin,
  onEvent: (m) => {
    if (m.type === "error") notice("作品のエラー: " + m.message);
    if (m.type === "violation") notice("作品を停止しました（" + m.message + "）");
    if (m.type === "escape") exitMode();
  },
});
await ctl.mount();
window.__canvasHost = { ctl, state }; // 試験での観測用（読み取りのみ）

function notice(t) {
  $("notice").textContent = t;
}

// ---- 表示モード ----
function setMode(mode) {
  state.mode = mode;
  host.classList.remove("mode-frame", "mode-fill", "mode-fullscreen");
  host.classList.add("mode-" + mode);
  for (const b of host.querySelectorAll("[data-mode]")) b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
}

async function enterMode(mode, trigger) {
  if (mode === state.mode) return;
  if (state.mode === "frame") state.returnFocus = trigger || document.activeElement;
  if (mode === "fullscreen") {
    if (!document.fullscreenEnabled || !host.requestFullscreen) {
      notice("全画面を使えないため、ブラウザ全面で表示しています");
      setMode("fill");
      return;
    }
    try {
      await host.requestFullscreen();
      setMode("fullscreen");
    } catch {
      notice("全画面を拒否されたため、ブラウザ全面で表示しています");
      setMode("fill");
    }
    return;
  }
  if (state.mode === "fullscreen" && document.fullscreenElement) await document.exitFullscreen().catch(() => {});
  setMode(mode);
  if (mode === "frame") restoreFocus();
}

function restoreFocus() {
  const el = state.returnFocus;
  state.returnFocus = null;
  if (el && document.contains(el)) el.focus();
}

async function exitMode() {
  if (state.mode === "fullscreen" && document.fullscreenElement) {
    await document.exitFullscreen().catch(() => {});
    return; // fullscreenchange で戻す
  }
  if (state.mode !== "frame") {
    setMode("frame");
    restoreFocus();
  }
}

document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && state.mode === "fullscreen") {
    setMode("frame");
    restoreFocus();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.mode === "fill") exitMode();
});
for (const b of host.querySelectorAll("[data-mode]")) b.addEventListener("click", () => enterMode(b.dataset.mode, b));
$("exit-mode").addEventListener("click", exitMode);

// ---- プレビュー ----
async function showPreview(source, label) {
  const p = await api("/api/previews", { method: "POST", body: source });
  state.previewSource = source;
  host.dataset.ready = "0";
  $("preview-label").textContent = label;
  const r = await ctl.start({ token: p.token, data: p.data, seed: 1, clock: CLOCK });
  host.dataset.ready = r.type === "ready" ? "1" : "0";
  if (r.type !== "ready") notice("起動できませんでした: " + (r.message || r.type));
  return r;
}
$("stop").addEventListener("click", () => ctl.stop());
$("restart").addEventListener("click", () => state.previewSource && showPreview(state.previewSource, $("preview-label").textContent));

// ---- 会話 ----
function addMessage(role, text) {
  const li = document.createElement("li");
  li.className = role;
  li.textContent = text;
  $("messages").appendChild(li);
  li.scrollIntoView({ block: "end" });
}

function setRunStatus(t) {
  $("run-status").textContent = t;
}

$("composer").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("message").value.trim();
  if (!text) return;
  $("message").value = "";
  addMessage("user", text);
  hideCandidate();
  let run;
  try {
    run = await api("/api/runs", { method: "POST", body: { message: text, artworkId: state.artworkId, conversation: state.conversation } });
  } catch (err) {
    addMessage("assistant", "受け付けられませんでした: " + err.message);
    return;
  }
  state.conversation.push({ role: "user", text });
  state.runId = run.id;
  $("cancel").disabled = false;
  setRunStatus("生成中…");
  pollRun(run.id);
});

$("message").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) $("composer").requestSubmit();
});

$("cancel").addEventListener("click", async () => {
  if (!state.runId) return;
  await api(`/api/runs/${state.runId}/cancel`, { method: "POST", body: {} }).catch(() => {});
});

const STATE_TEXT = { failed: "失敗しました", cancelled: "取り消しました", expired: "期限を過ぎました", superseded: "新しい依頼に置き換えました" };

async function pollRun(id) {
  for (;;) {
    await new Promise((r) => setTimeout(r, 250));
    if (state.runId !== id) return;
    let run;
    try {
      run = await api(`/api/runs/${id}`);
    } catch {
      continue;
    }
    if (run.state === "running") {
      setRunStatus(`生成中…（試行 ${run.attempts}）`);
      continue;
    }
    $("cancel").disabled = true;
    state.runId = null;
    if (run.state === "presented") {
      const c = run.candidates.find((x) => x.id === run.presentedCandidateId);
      setRunStatus(`候補を提示（試行 ${run.attempts}）`);
      addMessage("assistant", c.reply || "候補を作りました。");
      state.conversation.push({ role: "assistant", text: c.reply || "候補を作りました。" });
      showCandidate(c, run);
      await showPreview({ candidateId: c.id }, "候補");
    } else {
      // 契約違反・起動不能・取消のときは最後に開けた版を表示し続ける
      setRunStatus(STATE_TEXT[run.state] || run.state);
      addMessage("assistant", (STATE_TEXT[run.state] || run.state) + (run.failure ? `: ${run.failure}` : ""));
    }
    return;
  }
}

// ---- 候補・保存 ----
function hideCandidate() {
  $("candidate").hidden = true;
  state.candidate = null;
}

function showCandidate(c, run) {
  state.candidate = { ...c, baseRevision: run.baseRevision };
  state.saveKey = rid();
  $("candidate").hidden = false;
  $("cand-title").textContent = c.title;
  $("cand-digest").textContent = c.digest.slice(0, 19) + "…";
  $("cand-changes").textContent = c.changes;
  const ul = $("cand-checks");
  ul.textContent = "";
  for (const k of c.verification?.checks ?? []) {
    const li = document.createElement("li");
    li.className = k.pass ? "pass" : "fail";
    li.textContent = `${k.level}: ${k.id} ${k.pass ? "合格" : "不合格"}${k.detail ? "（" + k.detail + "）" : ""}`;
    ul.appendChild(li);
  }
  $("cand-unconfirmed").textContent = c.unconfirmed.length ? "未確認: " + c.unconfirmed.join(" / ") : "未確認: 依頼に沿うかの照合（自動では確定しない）";
  $("save-status").textContent = "";
  $("save").disabled = !c.verification?.requiredPassed;
}

$("save").addEventListener("click", async () => {
  const c = state.candidate;
  if (!c) return;
  $("save").disabled = true;
  try {
    const r = await api(`/api/candidates/${c.id}/save`, { method: "POST", body: { expectedRevision: c.baseRevision, idempotencyKey: state.saveKey } });
    state.artworkId = r.artworkId;
    state.currentRevision = r.revision;
    $("save-status").textContent = `保存しました（r${r.revision}）`;
    await refreshArtworks();
    await loadArtwork(r.artworkId, { keepPreview: true });
  } catch (err) {
    if (err.info?.code === "conflict") $("save-status").textContent = `競合: 現在版は r${err.info.currentRevision}。候補は残っています。現在版を開いて確認してください。`;
    else $("save-status").textContent = "保存できませんでした: " + err.message;
    $("save").disabled = false;
  }
});

// ---- 作品一覧・版 ----
async function refreshArtworks() {
  const list = await api("/api/artworks");
  const ul = $("artworks");
  ul.textContent = "";
  for (const a of list) {
    const li = document.createElement("li");
    if (a.id === state.artworkId) li.className = "active";
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = `${a.title}（r${a.currentRevision}）`;
    b.dataset.artworkId = a.id;
    b.addEventListener("click", () => openArtwork(a.id));
    li.appendChild(b);
    ul.appendChild(li);
  }
}

async function loadArtwork(id, { keepPreview = false } = {}) {
  const a = await api(`/api/artworks/${id}`);
  state.artworkId = a.id;
  state.currentRevision = a.currentRevision;
  $("current").textContent = `${a.title}（現在 r${a.currentRevision}）`;
  const ol = $("revisions");
  ol.textContent = "";
  for (const r of [...a.revisions].reverse()) {
    const li = document.createElement("li");
    li.dataset.revision = String(r.revision);
    li.append(`r${r.revision}${r.restoredFrom ? `（r${r.restoredFrom} から復元）` : ""} `);
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = "表示";
    open.addEventListener("click", () => showPreview({ artworkId: a.id, revision: r.revision }, `保存版 r${r.revision}`));
    li.appendChild(open);
    if (r.revision !== a.currentRevision) {
      const rs = document.createElement("button");
      rs.type = "button";
      rs.textContent = "この版を復元";
      rs.addEventListener("click", () => restore(a.id, r.revision));
      li.appendChild(rs);
    }
    ol.appendChild(li);
  }
  await refreshArtworks();
  if (!keepPreview) await showPreview({ artworkId: a.id }, `保存版 r${a.currentRevision}`);
}

async function openArtwork(id) {
  if (state.artworkId !== id) {
    state.conversation = [];
    $("messages").textContent = "";
  }
  hideCandidate();
  await loadArtwork(id);
}

async function restore(id, revision) {
  try {
    await api(`/api/artworks/${id}/restore`, { method: "POST", body: { revision, expectedRevision: state.currentRevision, idempotencyKey: rid() } });
    notice(`r${revision} を新しい版として復元しました`);
    await loadArtwork(id);
  } catch (err) {
    notice("復元できませんでした: " + err.message);
  }
}

$("new-artwork").addEventListener("click", () => {
  state.artworkId = null;
  state.currentRevision = 0;
  state.conversation = [];
  $("messages").textContent = "";
  $("revisions").textContent = "";
  $("current").textContent = "新規の作品";
  hideCandidate();
  refreshArtworks();
});

await refreshArtworks();
document.body.dataset.ready = "1";
