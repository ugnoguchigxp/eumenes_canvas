// 制作担当の手順（docs/maker-skill.md、SKILL 形式）を読み、制作担当の system に入れる文を組み立てる。
// 評価の直接生成（eval/p3/cond-d.ts）と、将来の製品側の実モデル接続口が同じ文書を使う。
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const MAKER_SKILL_PATH = resolve(import.meta.dir, "../../docs/maker-skill.md");

export interface MakerSkill {
  name: string;
  description: string;
  /** frontmatter を除いた本文。 */
  body: string;
}

/** SKILL 形式（--- で囲んだ frontmatter に name・description）の文書を読む。形が違えば例外。 */
export function parseMakerSkill(text: string): MakerSkill {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"));
  if (!m) throw new Error("maker-skill: frontmatter がない");
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  if (!meta.name || !meta.description) throw new Error("maker-skill: name・description がない");
  const body = m[2].trim();
  if (!body) throw new Error("maker-skill: 本文が空");
  return { name: meta.name, description: meta.description, body };
}

export function loadMakerSkill(path = MAKER_SKILL_PATH): MakerSkill {
  return parseMakerSkill(readFileSync(path, "utf8"));
}

/** 役割の短い前置き＋手順の本文。応答の形（JSON の項目）は呼び出し側の前置きで指定する。 */
export function makerSystemPrompt(skill: MakerSkill, preamble: string): string {
  return `${preamble.trim()}\n\n# 制作手順（${skill.name}）\n\n${skill.body}`;
}

export const makerSkillPathFrom = (root: string) => join(root, "docs/maker-skill.md");
