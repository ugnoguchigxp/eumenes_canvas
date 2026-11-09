// 汎用課題 general-v1 の課題・登録データ（docs/eval/general-v1.md）。実行器（eval/p3/run.ts --suite general）・判定・自己確認が共有する。
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ArtworkBody } from "../../src/contract/artwork";

export const EVAL = resolve(import.meta.dir, "..");

export interface GeneralTask {
  id: string;
  group: "new" | "modify" | "repair" | "nongame";
  seed: number;
  base?: string;
  /** 修復課題の対照（判定の自己確認用。制作担当には渡さない）。 */
  fixed?: string;
  baseTitle?: string;
  dataRef?: string;
  turns: string[];
}

export const GENERAL_TASKS = (JSON.parse(readFileSync(join(EVAL, "tasks/general.json"), "utf8")) as { tasks: GeneralTask[] }).tasks;

/** P2 の synthetic-sensors に、可視化課題の synthetic-monthly を加える。 */
export const GENERAL_DATASETS = [
  { ref: "synthetic-sensors", description: "合成センサー値（温度・湿度・気圧の 3 系列×25 点。groups[{name,color}], points[{group,x,y}]、x・y は 0〜100）", data: JSON.parse(readFileSync(join(EVAL, "data/synthetic-sensors.json"), "utf8")) },
  { ref: "synthetic-monthly", description: "合成の月別推移（2 系列×24 か月。months[]、series[{name,color,line,values[]}]、values は 0〜100）", data: JSON.parse(readFileSync(join(EVAL, "data/synthetic-monthly.json"), "utf8")) },
];
export const generalData = (ref?: string) => (ref ? (GENERAL_DATASETS.find((d) => d.ref === ref)?.data ?? null) : null);
export const generalBase = (t: GeneralTask): ArtworkBody | null =>
  t.base ? { title: t.baseTitle!, entry: readFileSync(join(EVAL, t.base), "utf8"), ...(t.dataRef ? { dataRef: t.dataRef } : {}) } : null;
