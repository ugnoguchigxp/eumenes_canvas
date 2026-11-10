// ホスト・シェル・作品 Worker の間で交わすメッセージの型と上限。
// ブラウザ（ホストとプレビューシェル）と Bun の試験の両方から読み込む。
export const PROTOCOL_VERSION = 1;

export const LIMITS = Object.freeze({
  hostToShellBytes: 80 * 1024, // start は入力 JSON（最大 64 KiB）を含む
  shellToHostBytes: 8 * 1024,
  statusBytes: 4 * 1024,
  errorMessageChars: 1000,
  statusPerSecond: 20,
  workerMessagesPerSecondHard: 300, // 超えたら作品を停止する
  workerMessageBytesHard: 1024 * 1024,
  maxCanvasDevicePixels: 4096,
  maxAdvanceMs: 60_000,
  svgChars: 256 * 1024, // api.decodeSVG に渡せる SVG の長さ
  svgPerSecond: 30, // 超えた復号の依頼は失敗として返す
  svgPending: 8, // シェルが同時に復号する件数
});

const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/;
const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

export function byteLength(value) {
  try {
    const s = typeof value === "string" ? value : JSON.stringify(value);
    if (s === undefined) return Infinity;
    return new TextEncoder().encode(s).length;
  } catch {
    return Infinity;
  }
}

function plain(m) {
  return m !== null && typeof m === "object" && !Array.isArray(m) && Object.getPrototypeOf(m) === Object.prototype;
}
function onlyKeys(m, keys) {
  return Object.keys(m).every((k) => keys.includes(k));
}
function finiteIn(n, lo, hi) {
  return typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi;
}

/** ホストからシェルへのメッセージを検査する。null なら破棄。 */
export function checkHostToShell(m) {
  if (!plain(m) || typeof m.type !== "string") return null;
  if (byteLength(m) > LIMITS.hostToShellBytes) return null;
  switch (m.type) {
    case "start":
      if (!onlyKeys(m, ["type", "runId", "token", "data", "seed", "clock"])) return null;
      if (!RUN_ID.test(m.runId) || !TOKEN.test(m.token)) return null;
      if (!finiteIn(m.seed, 0, 2 ** 32 - 1) || !Number.isInteger(m.seed)) return null;
      if (m.clock !== "raf" && m.clock !== "manual") return null;
      if (byteLength(m.data ?? null) > 64 * 1024) return null;
      return m;
    case "stop":
      if (!onlyKeys(m, ["type", "runId"]) || !RUN_ID.test(m.runId)) return null;
      return m;
    case "advance":
      if (!onlyKeys(m, ["type", "runId", "seq", "ms"]) || !RUN_ID.test(m.runId)) return null;
      if (!Number.isInteger(m.seq) || !finiteIn(m.seq, 0, 2 ** 31)) return null;
      if (!finiteIn(m.ms, 0, LIMITS.maxAdvanceMs)) return null;
      return m;
    default:
      return null;
  }
}

/** シェルからホストへのメッセージを検査する。null なら破棄。 */
export function checkShellToHost(m, expectedRunId) {
  if (!plain(m) || typeof m.type !== "string") return null;
  if (byteLength(m) > LIMITS.shellToHostBytes) return null;
  if (m.type === "shell-ready") return onlyKeys(m, ["type", "protocol"]) && m.protocol === PROTOCOL_VERSION ? m : null;
  if (typeof m.runId !== "string" || m.runId !== expectedRunId) return null;
  switch (m.type) {
    case "ready":
    case "stopped":
    case "escape":
      return onlyKeys(m, ["type", "runId"]) ? m : null;
    case "advanced":
      return onlyKeys(m, ["type", "runId", "seq"]) && Number.isInteger(m.seq) ? m : null;
    case "status":
      return onlyKeys(m, ["type", "runId", "value"]) && byteLength(m.value) <= LIMITS.statusBytes ? m : null;
    case "error":
    case "violation":
      return onlyKeys(m, ["type", "runId", "message"]) && typeof m.message === "string" && m.message.length <= LIMITS.errorMessageChars ? m : null;
    default:
      return null;
  }
}

/** 作品 Worker からシェルへのメッセージを検査する。作品は信頼しない。 */
export function checkWorkerToShell(m) {
  if (!plain(m) || typeof m.type !== "string") return null;
  switch (m.type) {
    case "ready":
      return onlyKeys(m, ["type"]) ? m : null;
    case "frame": {
      const b = m.bitmap;
      if (!onlyKeys(m, ["type", "bitmap"]) || typeof ImageBitmap === "undefined" || !(b instanceof ImageBitmap)) return null;
      if (b.width > LIMITS.maxCanvasDevicePixels || b.height > LIMITS.maxCanvasDevicePixels) return null;
      return m;
    }
    case "advanced":
      return onlyKeys(m, ["type", "seq"]) && Number.isInteger(m.seq) ? m : null;
    case "status":
      return onlyKeys(m, ["type", "value"]) && byteLength(m.value) <= LIMITS.statusBytes ? m : null;
    case "svg":
      if (!onlyKeys(m, ["type", "id", "svg"]) || !Number.isInteger(m.id) || !finiteIn(m.id, 1, 2 ** 31)) return null;
      return typeof m.svg === "string" && m.svg.length > 0 && m.svg.length <= LIMITS.svgChars ? m : null;
    case "error":
      return onlyKeys(m, ["type", "message"]) && typeof m.message === "string" ? { type: "error", message: m.message.slice(0, LIMITS.errorMessageChars) } : null;
    default:
      return null;
  }
}

/** 1 秒窓のレート制限。 */
export function makeRateWindow(now = () => Date.now()) {
  let start = now();
  let count = 0;
  return {
    hit() {
      const t = now();
      if (t - start >= 1000) {
        start = t;
        count = 0;
      }
      count += 1;
      return count;
    },
  };
}
