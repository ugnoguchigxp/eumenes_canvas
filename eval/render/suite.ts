// 描画方式の計測基板 render-v1 の課題・参照の作品・変異の対照（docs/eval/render-v1.md）。
// 実行器（eval/p3/run.ts --suite render）・判定・自己確認が共有する。参照の作品・変異・libraries は制作担当に渡さない。
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const EVAL = resolve(import.meta.dir, "..");

export interface RenderTask {
  id: string;
  group: "three" | "html" | "physics" | "shader";
  seed: number;
  /** 参照の作品が宣言する同梱ライブラリ（制作担当には渡さない）。 */
  libraries?: string[];
  turns: string[];
}

export const RENDER_TASKS = (JSON.parse(readFileSync(join(EVAL, "tasks/render.json"), "utf8")) as { tasks: RenderTask[] }).tasks;
export const goldEntry = (id: string) => readFileSync(join(EVAL, `gold/render/${id}.js`), "utf8");

/**
 * 変異の対照：参照の作品の 1 か所を書き換え、狙った観点（fails）だけが不合格になることを確かめる。
 * from は参照の作品にちょうど 1 回現れる文字列。
 */
export interface Mutant {
  task: string;
  name: string;
  from: string;
  to: string;
  fails: string[];
}
export const MUTANTS: Mutant[] = [
  { task: "R-T1-cube", name: "回転が半分の速さ", from: "angle += dt / 1000;", to: "angle += dt / 2000;", fails: ["rotates-1rad-per-s"] },
  { task: "R-T1-cube", name: "背景のクリックでも青", from: "if (ray.intersectObject(cube).length) state = \"blue\";", to: "state = \"blue\";", fails: ["click-blue"] },
  { task: "R-H1-panel", name: "↑で描き直さない", from: "score++; rebuild();", to: "score++;", fails: ["up-increments"] },
  { task: "R-H1-panel", name: "パネルが 20px 右", from: "const X = 40, Y = 40", to: "const X = 60, Y = 40", fails: ["layout"] },
  { task: "R-P1-pile", name: "上限なし", from: "balls.length < MAX", to: "balls.length < 1000", fails: ["max-30-and-reset"] },
  { task: "R-P1-pile", name: "当たりの半径が描画の半分（重なる）", from: "new CANNON.Sphere(R / S)", to: "new CANNON.Sphere(R / S / 2)", fails: ["drop-and-rest", "stack-no-overlap", "max-30-and-reset"] },
  { task: "R-P2-marbles", name: "坂 A に当たりがない（すり抜け）", from: "for (const r of RAMPS) bar(r[0], r[1], r[2], r[3], 8);", to: "bar(RAMPS[1][0], RAMPS[1][1], RAMPS[1][2], RAMPS[1][3], 8);", fails: ["rolls-down-ramp-a", "collect-in-bin-no-tunnel"] },
  { task: "R-P2-marbles", name: "Space で足さない", from: "if (ev.type === \"keydown\" && ev.code === \"Space\") spawn();", to: "", fails: ["space-adds"] },
  { task: "R-P3-flipper", name: "←を無視", from: "held = ev.type === \"keydown\";", to: "held = false;", fails: ["flipper-up-and-back", "flip-launches-ball"] },
  { task: "R-P3-flipper", name: "落とし直しを数えない", from: "{ drains++; drop(); }", to: "{ drop(); }", fails: ["drain-and-respawn"] },
  { task: "R-V1-blackhole", name: "光が曲がらない（影も弧もない）", from: "vec3 acc = -1.5 * h2 * pos / pow(r, 5.0);", to: "vec3 acc = vec3(0.0);", fails: ["shadow-ring-lensed-arc-stars"] },
  { task: "R-V1-blackhole", name: "円盤が回らない", from: "uniforms.uTime.value += s;", to: "", fails: ["disk-animates"] },
];

export function mutate(m: Mutant): string {
  const src = goldEntry(m.task);
  const n = src.split(m.from).length - 1;
  if (n !== 1) throw new Error(`変異 ${m.task}「${m.name}」の置換元が ${n} 回現れる`);
  return src.replace(m.from, m.to);
}
