// テスト用の版保存。所有 scope ごとに作品・版・候補・検証記録・受領結果を JSON ファイルへ保存する。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Artwork, Candidate, Revision, Run, SaveReceipt, Verification } from "./types";

interface State {
  version: 1;
  artworks: Record<string, Artwork>;
  revisions: Record<string, Revision[]>;
  runs: Record<string, Run>;
  candidates: Record<string, Candidate>;
  verifications: Record<string, Verification>;
  receipts: Record<string, SaveReceipt>;
  sessions: Record<string, number>; // owner|session|artwork → 最新の世代
}

const empty = (): State => ({ version: 1, artworks: {}, revisions: {}, runs: {}, candidates: {}, verifications: {}, receipts: {}, sessions: {} });

export class Store {
  private s: State;
  private file: string | null;
  constructor(dataDir: string | null) {
    this.file = dataDir ? join(dataDir, "store.json") : null;
    if (this.file && existsSync(this.file)) this.s = JSON.parse(readFileSync(this.file, "utf8"));
    else this.s = empty();
    if (dataDir) mkdirSync(dataDir, { recursive: true });
    // 再起動前に実行中だった作業は結果不明として閉じる（後から届いても採用しない）
    for (const r of Object.values(this.s.runs))
      if (r.state === "running") {
        r.state = "failed";
        r.failure = "ホストの再起動で中断";
        r.finishedAt = Date.now();
      }
  }

  private flush() {
    if (!this.file) return;
    const tmp = this.file + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.s));
    renameSync(tmp, this.file);
  }

  /** 変更はこの関数の中だけで行い、終わったら書き出す（単一 writer）。 */
  tx<T>(fn: (s: State) => T): T {
    const r = fn(this.s);
    this.flush();
    return r;
  }

  get artworks() {
    return this.s.artworks;
  }
  get runs() {
    return this.s.runs;
  }
  get candidates() {
    return this.s.candidates;
  }
  get verifications() {
    return this.s.verifications;
  }
  revisionsOf(artworkId: string): Revision[] {
    return this.s.revisions[artworkId] ?? [];
  }
  receipt(owner: string, key: string): SaveReceipt | undefined {
    return this.s.receipts[owner + "\u0000" + key];
  }
  putReceipt(s: State, r: SaveReceipt) {
    s.receipts[r.owner + "\u0000" + r.key] = r;
  }
  nextGeneration(s: State, owner: string, session: string, artworkId: string): number {
    const k = [owner, session, artworkId].join("\u0000");
    s.sessions[k] = (s.sessions[k] ?? 0) + 1;
    return s.sessions[k];
  }
  pushRevision(s: State, r: Revision) {
    (s.revisions[r.artworkId] ??= []).push(r);
  }
}
