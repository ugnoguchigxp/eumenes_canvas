// ページ直接モードの固定の実行時コード（design.md §8、docs/artwork-contract-v2-page.md）。
// 作品の文書 /p/<token> の中で、作品の本文より先に動く。シェルから初期化（データ・seed・時計）と専用のポートを受け取ってから、
// 作品の本文 /pw/<token> を読み込む。作品は同じ文書で動くので、この実行時コードは安全の境界ではない（境界はシェルとホストの検査、CSP、sandbox）。
(() => {
  "use strict";
  const token = location.pathname.split("/")[2] || "";
  const stage = document.getElementById("stage");
  let port = null;
  const queue = [];
  let started = false;
  let loading = false;
  let loadError = false;
  let statusSent = 0;
  const send = (m) => {
    if (port) port.postMessage(m);
    else if (queue.length < 50) queue.push(m);
  };
  const errText = (v) => String((v && (v.message || v)) || "error").slice(0, 1000);
  addEventListener("error", (e) => {
    if (loading) loadError = true;
    send({ type: "error", message: errText(e.error || e.message) + (e.lineno ? `（作品の文書 ${e.lineno} 行 ${e.colno} 列）` : "") });
  });
  addEventListener("unhandledrejection", (e) => send({ type: "error", message: "unhandledrejection: " + errText(e.reason) }));
  // Esc はホストが使う（表示モードの退出）。作品の文書で最初に捕まえてシェルへ渡し、作品には渡さない（契約 v1 と同じ）
  for (const type of ["keydown", "keyup"])
    addEventListener(type, (e) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      if (type === "keydown" && e.isTrusted) send({ type: "escape" });
    }, true);

  // 画面いっぱいの canvas の大きさ（CSS ピクセル × DPR）。作品の resize の聞き手より先に設定する（先に登録した聞き手が先に呼ばれる）
  function sizeStage() {
    const dpr = Math.min(window.devicePixelRatio || 1, 4);
    const w = Math.max(1, Math.min(4096, Math.round(innerWidth * dpr)));
    const h = Math.max(1, Math.min(4096, Math.round(innerHeight * dpr)));
    if (stage.width !== w) stage.width = w;
    if (stage.height !== h) stage.height = h;
  }
  addEventListener("resize", sizeStage);

  function deepFreeze(v) {
    if (v && typeof v === "object" && !Object.isFrozen(v)) {
      Object.freeze(v);
      for (const k of Object.keys(v)) deepFreeze(v[k]);
    }
    return v;
  }

  // 観測の時計：rAF・setTimeout・setInterval・performance.now・Date.now を仮想の時計にし、ホストの advance で 16ms ずつ進める
  let advance = (_ms) => {};
  function manualClock() {
    const T0 = 1767225600000; // 仮想の Date.now の起点（固定）
    let now = 0;
    const raf = new Map();
    let rafId = 0;
    const timers = new Map();
    let timerId = 0;
    const call = (f, ...a) => {
      try {
        f(...a);
      } catch (e) {
        send({ type: "error", message: errText(e) });
      }
    };
    window.requestAnimationFrame = (f) => { raf.set(++rafId, f); return rafId; };
    window.cancelAnimationFrame = (id) => { raf.delete(id); };
    window.setTimeout = (f, ms = 0, ...a) => { timers.set(++timerId, { f, at: now + Math.max(0, +ms || 0), every: 0, a }); return timerId; };
    window.setInterval = (f, ms = 0, ...a) => { const e = Math.max(1, +ms || 0); timers.set(++timerId, { f, at: now + e, every: e, a }); return timerId; };
    window.clearTimeout = window.clearInterval = (id) => { timers.delete(id); };
    performance.now = () => now;
    Date.now = () => T0 + now;
    const step = () => {
      for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at > now || !timers.has(id)) continue;
        if (t.every) t.at += t.every;
        else timers.delete(id);
        if (typeof t.f === "function") call(t.f, ...t.a);
      }
      const fs = [...raf.values()];
      raf.clear();
      for (const f of fs) call(f, now);
    };
    advance = (ms) => {
      const end = now + ms;
      while (now + 16 <= end) {
        now += 16;
        step();
      }
      now = end;
    };
    return { first: () => { const fs = [...raf.values()]; raf.clear(); for (const f of fs) call(f, now); } };
  }

  function init(d) {
    if (started) return;
    started = true;
    // seed 固定の乱数（mulberry32）
    let s = d.seed >>> 0 || 1;
    Math.random = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const clock = d.clock === "manual" ? manualClock() : null;
    const host = Object.freeze({
      data: deepFreeze(d.data === undefined ? null : d.data),
      seed: d.seed >>> 0,
      // v1 と同じく JSON にできる値だけ、1000 件まで（上限・頻度はシェルとホストが検査する）
      status: (value) => {
        if (statusSent >= 1000) return;
        statusSent++;
        try {
          send({ type: "status", value: JSON.parse(JSON.stringify(value)) });
        } catch {}
      },
    });
    Object.defineProperty(window, "canvasHost", { value: host, writable: false, configurable: false });
    sizeStage();
    const sc = document.createElement("script");
    // CORS で読む（不透明オリジンの文書から見て作品の本文は別オリジンなので、そのままでは例外の内容が "Script error." に伏せられる）
    sc.crossOrigin = "anonymous";
    sc.src = "/pw/" + encodeURIComponent(token);
    loading = true;
    sc.onload = () => {
      loading = false;
      if (loadError) return; // 作品の本文の実行中に例外（error は送った）
      if (clock) clock.first(); // 観測：最初の 1 回の rAF を時刻 0 で呼んで描かせる
      send({ type: "ready" });
    };
    sc.onerror = () => {
      loading = false;
      send({ type: "error", message: "作品の本文を読み込めない" });
    };
    document.body.appendChild(sc);
  }

  function onPort(e) {
    const m = e.data || {};
    if (m.type === "advance" && Number.isInteger(m.seq)) {
      advance(Math.max(0, Math.min(60000, +m.ms || 0)));
      send({ type: "advanced", seq: m.seq });
    } else if (m.type === "poke" && Number.isInteger(m.seq)) {
      send({ type: "advanced", seq: m.seq }); // 時間を進めない描き直しは無い（契約 v2）
    }
  }

  // シェルからの最初の初期化だけを受ける（作品の本文はまだ読み込まれていないので、作品はこのポートを受け取れない）
  addEventListener("message", function connect(e) {
    if (port || e.source !== parent || !e.ports || e.ports.length !== 1) return;
    const d = e.data;
    if (!d || d.type !== "page-init") return;
    port = e.ports[0];
    port.onmessage = onPort;
    removeEventListener("message", connect);
    for (const m of queue.splice(0)) port.postMessage(m);
    init(d);
  });
})();
