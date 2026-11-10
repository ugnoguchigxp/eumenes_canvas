// 制作担当の宣言（要件と操作）と、その正規化。宣言は「制作担当がそう言っている」だけで、合否には使わない。
// ホストが実際に入力して確かめる材料（性質の観測）と、検証担当が要件ごとに判定する一覧（07）に使う。

/** 宣言・台本で使える入力名（KeyboardEvent.code）。Tab と Escape はホストが使うので入れない。 */
export const INPUT_RE = /^(Key[A-Z]|Digit[0-9]|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Space|Enter|ShiftLeft|Backspace)$/;
/** 観測のときの作品の面の寸法（CSS ピクセル）。 */
export const FRAME_W = 480;
export const FRAME_H = 360;

export interface Requirement { id: string; text: string } // id は "R1", "R2", …（ホストが振る）
export interface Control { kind: "key" | "pointer"; input: string; action: string; always: boolean }
export interface MakerSpec { requirements: Requirement[]; controls: Control[] }

/** 文字列で、前後の空白を除いて空でなければ max 文字で切って返す。そうでなければ null。 */
export function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

/** 物（null でも配列でもない object）ならそのまま、そうでなければ null。 */
export function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** 有限の数で lo 以上 hi 以下なら四捨五入して返す。そうでなければ null。 */
export function int(v: unknown, lo: number, hi: number): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : null;
}

const MAX_REQUIREMENTS = 20;
const MAX_CONTROLS = 12;

/** モデルの出力を、形の合う部分だけ残して MakerSpec にする（内容は書き換えない）。要件が 0 個なら null。 */
export function normalizeSpec(raw: unknown): MakerSpec | null {
  const o = obj(raw);
  if (!o || !Array.isArray(o.requirements)) return null;
  const requirements: Requirement[] = [];
  for (const r of o.requirements) {
    if (requirements.length >= MAX_REQUIREMENTS) break;
    const text = typeof r === "string" ? str(r, 300) : str(obj(r)?.text, 300);
    // id はホストが順に振る（モデルが書いた id は使わない）
    if (text) requirements.push({ id: `R${requirements.length + 1}`, text });
  }
  if (!requirements.length) return null;
  const controls: Control[] = [];
  if (Array.isArray(o.controls)) {
    let pointer = false;
    const keys = new Set<string>();
    for (const c of o.controls) {
      if (controls.length >= MAX_CONTROLS) break;
      const co = obj(c);
      if (!co) continue;
      const action = str(co.action, 100);
      if (!action) continue;
      const always = co.always === true;
      if (co.kind === "pointer") {
        if (pointer) continue;
        pointer = true;
        controls.push({ kind: "pointer", input: "pointer", action, always });
      } else if (co.kind === "key") {
        if (typeof co.input !== "string" || !INPUT_RE.test(co.input) || keys.has(co.input)) continue;
        keys.add(co.input);
        controls.push({ kind: "key", input: co.input, action, always });
      }
    }
  }
  return { requirements, controls };
}
