// 作品 Worker の固定ブートストラップ（実行契約 v1）。
// プレビューオリジンが作品本体の前に連結して配信する。応答の CSP は default-src 'none'。
"use strict";
// 宣言されたホスト同梱ライブラリ（src/preview/libs/*.js）が名前空間を置く場所。作品には引数として渡す。
var __canvasLibs = {};
// 作品本体の 1 行目の直前までの行数。プレビューの配信が作品の直前で設定する。
var __canvasEntryLine = 0;
var __canvasApp = (function () {
  var post = self.postMessage.bind(self);
  var addListener = self.addEventListener.bind(self);

  // CSP が覆わない保存・同一オリジン通信の API を作品から外す（多層防御）。
  // 通信・外部コード読込・子 Worker は応答の CSP で拒否する。
  // WebAssembly は契約で使えない。Chromium は CSP（'unsafe-eval' なし）で拒否するが、WebKit 26.0 は Worker で compile できた（2026-11-10 実測）ため外す。
  var removed = ["indexedDB", "caches", "BroadcastChannel", "SharedWorker", "cookieStore", "WebAssembly"];
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
  var canvas3d = null; // 3D の面。複写方式では、作品が初めて api.canvas3d を読んだときに作る
  var used3d = false; // 作品が api.canvas3d を読んだか
  var direct = false; // 画面の canvas を直接受け取ったか（直接描画）
  var split = false; // 作品が frame の代わりに update・draw を返したか
  var needDraw = false; // draw を呼ぶ必要があるか
  var selfClock = false; // Worker 自身の requestAnimationFrame で進めているか
  var size = { width: 1, height: 1, dpr: 1 };
  var t = 0;
  var lastTickT = null;
  var errorsSent = 0;
  var statusSent = 0;
  // SVG（HTML を含む foreignObject）の復号。Worker には DOM が無いので、シェルが画像として復号して ImageBitmap を返す。
  var svgSeq = 0;
  var svgPending = {}; // id -> { resolve, reject }
  var svgPendingCount = 0;
  var MAX_SVG_CHARS = 256 * 1024;
  var MAX_SVG_PENDING = 8;
  var bootWaiters = null; // 起動中に頼まれた復号を ready の前に待つ

  // 例外のスタックから、作品本体の行と列を取り出す（行と列の数字だけ。トークンは文に入れない）。
  // Chromium の「at f (…/w/<token>:262:17)」と WebKit の「f@…/w/<token>:262:17」の両方に一致する。
  // ブートストラップやライブラリの中の行（作品の 1 行目より前）なら空文字。
  function entryPos(err) {
    var m = /\/w\/[^\s:)]+:(\d+):(\d+)/.exec(String((err && err.stack) || ""));
    if (!m) return "";
    var line = Number(m[1]) - __canvasEntryLine;
    if (!(line >= 1)) return "";
    return "（作品の " + line + " 行 " + m[2] + " 列）";
  }

  function reportError(where, err) {
    if (errorsSent >= 5) return;
    errorsSent++;
    var msg = where + ": " + (err && err.message ? err.message : String(err));
    // 位置の文を足しても 1000 文字（LIMITS.errorMessageChars）を超えないよう、本文は 940 文字で切る
    post({ type: "error", message: msg.slice(0, 940) + entryPos(err) });
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
    if (presentCanvas) {
      presentCanvas.width = canvas.width;
      presentCanvas.height = canvas.height;
    }
    // 3D の面は作品の resize の前に 2D の面と同じ寸法にする（作品は resize の中で変えてよい）
    if (canvas3d) {
      canvas3d.width = canvas.width;
      canvas3d.height = canvas.height;
    }
    api.width = size.width;
    api.height = size.height;
    api.dpr = size.dpr;
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
  }

  function call(name, args) {
    if (!handlers || typeof handlers[name] !== "function") return;
    // ループの実行時間の予算は、作品の関数 1 回の呼び出しごとに数える（execution-budget.js はこのファイルの後ろに連結されるので、呼ぶ時に探す）
    if (typeof __canvasResetExecution === "function") __canvasResetExecution();
    try {
      handlers[name].apply(handlers, args);
    } catch (e) {
      reportError(name, e);
    }
  }

  // 時間を dt だけ進める。update・draw の形では、update は dt > 0 のときだけ呼び、draw は present の直前に 1 回だけ呼ぶ。
  function frame(dt) {
    t += dt;
    if (split) {
      if (dt > 0) call("update", [t, dt]);
      needDraw = true;
    } else {
      ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      call("frame", [t, dt]);
    }
    dirty = true;
  }

  // 描画面を複製し、ImageBitmap としてシェルへ渡す（作品の描画内容は保持される）。
  // 直接描画では画面の canvas に描いているので、何も送らない。複写方式で 3D の面を使う作品は、3D の面を下、2D の面を上に重ねる。
  function present() {
    if (!dirty) return;
    dirty = false;
    if (split && needDraw) {
      needDraw = false;
      ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      call("draw", [t]);
    }
    if (direct) return;
    presentCtx.setTransform(1, 0, 0, 1, 0, 0);
    presentCtx.clearRect(0, 0, presentCanvas.width, presentCanvas.height);
    if (used3d && canvas3d) presentCtx.drawImage(canvas3d, 0, 0, presentCanvas.width, presentCanvas.height);
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

  function sendReady() {
    if (!bootWaiters) return;
    bootWaiters = null;
    frame(0);
    present();
    post({ type: "ready" });
  }

  addListener("message", function (ev) {
    var m = ev.data;
    if (!m || typeof m !== "object") return;
    if (m.type === "init") {
      // 直接描画：シェルが画面の 2D・3D の canvas を渡したときは、そこへ直接描く（表示用の面は作らない）
      direct = !!(m.canvas2d && m.canvas3d);
      if (direct) {
        canvas = m.canvas2d;
        canvas3d = m.canvas3d;
      } else {
        canvas = new OffscreenCanvas(1, 1);
        presentCanvas = new OffscreenCanvas(1, 1);
        presentCtx = presentCanvas.getContext("2d");
      }
      ctx = canvas.getContext("2d");
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
        decodeSVG: function (svg) {
          return new Promise(function (resolve, reject) {
            if (typeof svg !== "string" || svg.length === 0) return reject(new TypeError("decodeSVG: SVG の文字列を渡す"));
            if (svg.length > MAX_SVG_CHARS) return reject(new RangeError("decodeSVG: SVG は " + MAX_SVG_CHARS + " 文字まで"));
            if (svgPendingCount >= MAX_SVG_PENDING) return reject(new Error("decodeSVG: 同時に復号できるのは " + MAX_SVG_PENDING + " 件まで"));
            var id = ++svgSeq;
            svgPending[id] = { resolve: resolve, reject: reject };
            svgPendingCount++;
            post({ type: "svg", id: id, svg: svg });
          });
        },
      };
      Object.freeze(api.random);
      Object.freeze(api.decodeSVG);
      // 3D の面（WebGL などで描く。2D の面の下に重なる）。何度読んでも同じ面を返す
      Object.defineProperty(api, "canvas3d", {
        enumerable: false,
        get: function () {
          used3d = true;
          if (!canvas3d) canvas3d = new OffscreenCanvas(canvas.width, canvas.height);
          return canvas3d;
        },
      });
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
      // frame が無く update か draw がある作品は、更新と描画を分けて呼ぶ（frame があれば frame の形）
      split = typeof handlers.frame !== "function" && (typeof handlers.update === "function" || typeof handlers.draw === "function");
      call("resize", [size.width, size.height, size.dpr]);
      frame(0);
      present();
      if (svgPendingCount === 0) {
        post({ type: "ready" });
      } else {
        // 起動中に頼まれた SVG の復号が済むまで（最大 3 秒）ready を待つ。済んだら dt=0 で描き直してから知らせる。
        var readyTimer = setTimeout(sendReady, 3000);
        bootWaiters = function () { if (svgPendingCount === 0) { clearTimeout(readyTimer); sendReady(); } };
      }
      // 直接描画で、シェルが許したときは Worker 自身の requestAnimationFrame で進める
      if (direct && m.selfClock === true && typeof self.requestAnimationFrame === "function") {
        selfClock = true;
        var lastNow = null;
        var loop = function (now) {
          var d = lastNow === null ? 0 : Math.min(100, Math.max(0, now - lastNow));
          lastNow = now;
          frame(d);
          present();
          self.requestAnimationFrame(loop);
        };
        self.requestAnimationFrame(loop);
      }
      return;
    } else if (m.type === "svg-result" || m.type === "svg-error") {
      var p = svgPending[m.id];
      if (!p) return;
      delete svgPending[m.id];
      svgPendingCount--;
      if (m.type === "svg-result") p.resolve(m.bitmap);
      else p.reject(new Error("decodeSVG: " + String(m.message || "復号できない")));
      // 作品の then が済んでから、dt=0 で描き直す（復号の結果をすぐ描くため）
      Promise.resolve().then(function () {
        if (bootWaiters) { bootWaiters(); return; }
        frame(0);
        present();
      });
    } else if (!api) {
      return;
    } else if (m.type === "tick") {
      if (selfClock) return;
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
    } else if (m.type === "poke") {
      // 観測用の時間を進めない描き直し：t を変えずに frame(t, 0) を count 回
      for (var k = 0; k < m.count; k++) frame(0);
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
