// 作品 Worker の固定ブートストラップ（実行契約 v1）。
// プレビューオリジンが作品本体の前に連結して配信する。応答の CSP は default-src 'none'。
"use strict";
var __canvasApp = (function () {
  var post = self.postMessage.bind(self);
  var addListener = self.addEventListener.bind(self);

  // CSP が覆わない保存・同一オリジン通信の API を作品から外す（多層防御）。
  // 通信・外部コード読込・子 Worker は応答の CSP で拒否する。
  var removed = ["indexedDB", "caches", "BroadcastChannel", "SharedWorker", "cookieStore"];
  for (var i = 0; i < removed.length; i++) {
    var name = removed[i];
    for (var o = self; o; o = Object.getPrototypeOf(o)) {
      try {
        if (Object.prototype.hasOwnProperty.call(o, name)) delete o[name];
      } catch (e) {}
    }
    try {
      Object.defineProperty(self, name, { value: undefined, writable: false, configurable: false });
    } catch (e) {}
  }
  try {
    var navProto = Object.getPrototypeOf(self.navigator);
    ["storage", "locks", "serviceWorker"].forEach(function (k) {
      try {
        Object.defineProperty(navProto, k, { get: function () { return undefined; }, configurable: false });
      } catch (e) {}
    });
  } catch (e) {}

  var setupFn = null;
  var handlers = null;
  var api = null;
  var ctx = null;
  var canvas = null; // 作品が描く面（内容を保持する）
  var presentCanvas = null; // 表示用に複製して ImageBitmap として渡す面
  var presentCtx = null;
  var dirty = false;
  var size = { width: 1, height: 1, dpr: 1 };
  var t = 0;
  var lastTickT = null;
  var errorsSent = 0;
  var statusSent = 0;

  function reportError(where, err) {
    if (errorsSent >= 5) return;
    errorsSent++;
    var msg = where + ": " + (err && err.message ? err.message : String(err));
    post({ type: "error", message: msg.slice(0, 1000) });
  }

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var r = Math.imul(a ^ (a >>> 15), 1 | a);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function applySize() {
    canvas.width = Math.max(1, Math.round(size.width * size.dpr));
    canvas.height = Math.max(1, Math.round(size.height * size.dpr));
    presentCanvas.width = canvas.width;
    presentCanvas.height = canvas.height;
    api.width = size.width;
    api.height = size.height;
    api.dpr = size.dpr;
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
  }

  function call(name, args) {
    if (!handlers || typeof handlers[name] !== "function") return;
    try {
      handlers[name].apply(handlers, args);
    } catch (e) {
      reportError(name, e);
    }
  }

  function frame(dt) {
    t += dt;
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    call("frame", [t, dt]);
    dirty = true;
  }

  // 描画面を複製し、ImageBitmap としてシェルへ渡す（作品の描画内容は保持される）。
  function present() {
    if (!dirty) return;
    dirty = false;
    presentCtx.setTransform(1, 0, 0, 1, 0, 0);
    presentCtx.clearRect(0, 0, presentCanvas.width, presentCanvas.height);
    presentCtx.drawImage(canvas, 0, 0);
    var bmp = presentCanvas.transferToImageBitmap();
    post({ type: "frame", bitmap: bmp }, [bmp]);
  }

  function deepFreeze(v) {
    if (v && typeof v === "object") {
      Object.freeze(v);
      Object.keys(v).forEach(function (k) { deepFreeze(v[k]); });
    }
    return v;
  }

  addListener("message", function (ev) {
    var m = ev.data;
    if (!m || typeof m !== "object") return;
    if (m.type === "init") {
      canvas = new OffscreenCanvas(1, 1);
      ctx = canvas.getContext("2d");
      presentCanvas = new OffscreenCanvas(1, 1);
      presentCtx = presentCanvas.getContext("2d");
      size = { width: m.width, height: m.height, dpr: m.dpr };
      var rand = mulberry32(m.seed >>> 0);
      api = {
        canvas: canvas,
        ctx: ctx,
        width: size.width,
        height: size.height,
        dpr: size.dpr,
        data: deepFreeze(m.data === undefined ? null : m.data),
        random: function () { return rand(); },
        status: function (value) {
          if (statusSent >= 1000) return;
          statusSent++;
          try { post({ type: "status", value: JSON.parse(JSON.stringify(value)) }); } catch (e) {}
        },
      };
      Object.freeze(api.random);
      applySize();
      if (typeof setupFn !== "function") {
        reportError("start", new Error("canvasApp.start(setup) が呼ばれていない"));
        return;
      }
      try {
        handlers = setupFn(api) || {};
      } catch (e) {
        reportError("setup", e);
        return;
      }
      call("resize", [size.width, size.height, size.dpr]);
      frame(0);
      present();
      post({ type: "ready" });
    } else if (!api) {
      return;
    } else if (m.type === "tick") {
      var dt = lastTickT === null ? 0 : Math.min(100, Math.max(0, m.t - lastTickT));
      lastTickT = m.t;
      frame(dt);
      present();
    } else if (m.type === "advance") {
      var left = m.ms;
      while (left > 0) {
        var step = Math.min(16, left);
        frame(step);
        left -= step;
      }
      present();
      post({ type: "advanced", seq: m.seq });
    } else if (m.type === "input") {
      call("input", [m.ev]);
      if (m.ev && m.ev.type !== "pointermove") { frame(0); present(); }
    } else if (m.type === "resize") {
      size = { width: m.width, height: m.height, dpr: m.dpr };
      applySize();
      call("resize", [size.width, size.height, size.dpr]);
      frame(0);
      present();
    }
  });

  return Object.freeze({
    version: 1,
    start: function (setup) {
      if (setupFn) throw new Error("canvasApp.start は 1 回だけ呼べる");
      setupFn = setup;
    },
  });
})();
