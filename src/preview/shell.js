// 固定プレビューシェル。プレビューオリジンで動き、作品 Worker を起動・停止・中継する。
// HOST_ORIGIN はサーバーが配信時に先頭へ定数として埋め込む。
import { PROTOCOL_VERSION, LIMITS, checkHostToShell, checkWorkerToShell, byteLength, makeRateWindow } from "/shared/messages.js";

/* global HOST_ORIGIN */
const stage = document.getElementById("stage");
let port = null;
let worker = null;
let runId = null;
let canvas = null;
let resizeObs = null;
let rafHandle = 0;
let t0 = 0;
let pendingMove = null;
const statusRate = makeRateWindow();
const svgRate = makeRateWindow();
let svgActive = 0;
const hardRate = makeRateWindow();

const PASS_KEYS = new Set(["Tab", "Escape"]);
const PREVENT_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"]);

function send(m) {
  if (port && byteLength(m) <= LIMITS.shellToHostBytes) port.postMessage(m);
}

function stopWorker(reason) {
  pendingMove = null;
  if (rafHandle) cancelAnimationFrame(rafHandle);
  rafHandle = 0;
  if (resizeObs) resizeObs.disconnect();
  resizeObs = null;
  if (worker) {
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
  }
  worker = null;
  if (canvas) canvas.remove();
  canvas = null;
  const id = runId;
  runId = null;
  return id;
}

function sizeOf() {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 4);
  let w = Math.max(1, Math.round(r.width));
  let h = Math.max(1, Math.round(r.height));
  const maxCss = Math.floor(LIMITS.maxCanvasDevicePixels / dpr);
  w = Math.min(w, maxCss);
  h = Math.min(h, maxCss);
  return { width: w, height: h, dpr };
}

function toWorker(m, transfer) {
  if (worker) worker.postMessage(m, transfer || []);
}

function pointerEv(type, e) {
  const r = canvas.getBoundingClientRect();
  return { type, x: e.clientX - r.left, y: e.clientY - r.top, button: e.button, pointerType: e.pointerType || "mouse" };
}

function start(m) {
  stopWorker("restart");
  runId = m.runId;
  canvas = document.createElement("canvas");
  canvas.tabIndex = 0;
  stage.appendChild(canvas);
  const s = sizeOf();
  const view = canvas.getContext("bitmaprenderer");
  const thisRun = runId;
  worker = new Worker("/w/" + encodeURIComponent(m.token), { name: "artwork-" + runId });
  worker.onerror = (e) => {
    e.preventDefault();
    if (runId === thisRun) send({ type: "error", runId: thisRun, message: String(e.message || "worker error").slice(0, LIMITS.errorMessageChars) });
  };
  worker.onmessage = (e) => {
    if (runId !== thisRun) return;
    const n = hardRate.hit();
    if (n > LIMITS.workerMessagesPerSecondHard || byteLength(e.data) > LIMITS.workerMessageBytesHard) {
      stopWorker("violation");
      send({ type: "violation", runId: thisRun, message: n > LIMITS.workerMessagesPerSecondHard ? "message-rate" : "message-size" });
      return;
    }
    const msg = checkWorkerToShell(e.data);
    if (!msg) return; // 型・大きさが合わない通知は破棄する
    if (msg.type === "frame") {
      if (canvas.width !== msg.bitmap.width) canvas.width = msg.bitmap.width;
      if (canvas.height !== msg.bitmap.height) canvas.height = msg.bitmap.height;
      view.transferFromImageBitmap(msg.bitmap);
      return;
    }
    if (msg.type === "svg") {
      decodeSvg(msg, thisRun);
      return;
    }
    if (msg.type === "status" && statusRate.hit() > LIMITS.statusPerSecond) return;
    if (msg.type === "advanced" || msg.type === "ready") {
      // 描画面の反映を待ってから知らせる
      requestAnimationFrame(() => requestAnimationFrame(() => runId === thisRun && send({ ...msg, runId: thisRun })));
      return;
    }
    send({ ...msg, runId: thisRun });
  };
  toWorker({ type: "init", width: s.width, height: s.height, dpr: s.dpr, data: m.data ?? null, seed: m.seed });

  let last = s;
  resizeObs = new ResizeObserver(() => {
    if (!canvas) return;
    const n = sizeOf();
    if (n.width !== last.width || n.height !== last.height || n.dpr !== last.dpr) {
      last = n;
      toWorker({ type: "resize", ...n });
    }
  });
  resizeObs.observe(canvas);

  canvas.addEventListener("pointerdown", (e) => {
    canvas.focus();
    flushMove();
    toWorker({ type: "input", ev: pointerEv("pointerdown", e) });
  });
  canvas.addEventListener("pointerup", (e) => toWorker({ type: "input", ev: pointerEv("pointerup", e) }));
  canvas.addEventListener("pointermove", (e) => {
    pendingMove = pointerEv("pointermove", e); // 1 描画フレームに 1 回へまとめる
  });

  if (m.clock === "raf") {
    t0 = performance.now();
    const loop = () => {
      if (runId !== thisRun) return;
      flushMove();
      toWorker({ type: "tick", t: performance.now() - t0 });
      rafHandle = requestAnimationFrame(loop);
    };
    rafHandle = requestAnimationFrame(loop);
  } else {
    const moveLoop = () => {
      if (runId !== thisRun) return;
      flushMove();
      rafHandle = requestAnimationFrame(moveLoop);
    };
    rafHandle = requestAnimationFrame(moveLoop);
  }
}

// 作品が渡した SVG（foreignObject の HTML を含む）を画像として復号し、ImageBitmap を作品へ返す。
// SVG を画像として読むので、SVG 内のスクリプトは動かず、外部の資源も読まない（シェルの CSP は img-src data: だけ）。
async function decodeSvg(msg, thisRun) {
  const fail = (message) => runId === thisRun && toWorker({ type: "svg-error", id: msg.id, message });
  if (svgRate.hit() > LIMITS.svgPerSecond) return fail("復号の依頼が多すぎる（毎秒 " + LIMITS.svgPerSecond + " 件まで）");
  if (svgActive >= LIMITS.svgPending) return fail("同時に復号できる件数を超えた");
  svgActive++;
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(msg.svg);
    await img.decode();
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!(w > 0 && h > 0)) return fail("SVG の width・height が無い");
    if (w > LIMITS.maxCanvasDevicePixels || h > LIMITS.maxCanvasDevicePixels) return fail("SVG が大きすぎる（" + LIMITS.maxCanvasDevicePixels + " px まで）");
    // Chromium は SVG 画像から直接作った ImageBitmap を origin-clean でないとして転送を拒む（2026-11-10 実測、DataCloneError）。
    // 同一オリジンの OffscreenCanvas に描いてから取り出すと転送できる（描いた面は汚染されない）。
    const c = new OffscreenCanvas(w, h);
    c.getContext("2d").drawImage(img, 0, 0, w, h);
    const bmp = c.transferToImageBitmap();
    if (runId !== thisRun) return bmp.close();
    toWorker({ type: "svg-result", id: msg.id, bitmap: bmp }, [bmp]);
  } catch (e) {
    fail("SVG を画像として復号できない" + (e && e.name ? "（" + e.name + "）" : ""));
  } finally {
    svgActive--;
  }
}

function flushMove() {
  if (pendingMove) {
    toWorker({ type: "input", ev: pendingMove });
    pendingMove = null;
  }
}

for (const type of ["keydown", "keyup"]) {
  window.addEventListener(type, (e) => {
    if (!worker) return;
    if (PASS_KEYS.has(e.key)) {
      // Esc は作品へ渡さず、ホストに表示モードの退出を知らせる（利用者の操作だけが起点）
      if (e.key === "Escape" && type === "keydown" && e.isTrusted && runId) send({ type: "escape", runId });
      return;
    }
    if (PREVENT_KEYS.has(e.code)) e.preventDefault();
    if (e.repeat && type === "keydown") return;
    toWorker({ type: "input", ev: { type, code: String(e.code).slice(0, 32), key: String(e.key).slice(0, 32) } });
  });
}

function onHostMessage(e) {
  const m = checkHostToShell(e.data);
  if (!m) return;
  if (m.type === "start") start(m);
  else if (m.type === "stop" && m.runId === runId) {
    stopWorker("stop");
    send({ type: "stopped", runId: m.runId });
  } else if (m.type === "advance" && m.runId === runId) toWorker({ type: "advance", seq: m.seq, ms: m.ms });
}

// ホストは 1 回だけポートを渡す。送信元とオリジンを照合する。
window.addEventListener("message", function connect(e) {
  if (port) return;
  if (e.source !== window.parent || e.origin !== HOST_ORIGIN) return;
  if (!e.data || e.data.type !== "canvas-connect" || !e.ports || e.ports.length !== 1) return;
  port = e.ports[0];
  port.onmessage = onHostMessage;
  window.removeEventListener("message", connect);
  send({ type: "shell-ready", protocol: PROTOCOL_VERSION });
});
