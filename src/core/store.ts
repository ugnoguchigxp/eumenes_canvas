// テスト用の版保存。所有 scope ごとに作品・版・候補・検証記録・受領結果を JSON ファイルへ保存する。
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { open, rename } from "node:fs/promises";
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

type Collection = Exclude<keyof State, "version">;
const isHistory = (key: string) => key === "revisions" || key === "candidates";
type Commit = <K extends Collection, T>(collections: readonly K[], mutate: (s: Pick<State, K>) => T) => Promise<T>;

const empty = (): State => ({ version: 1, artworks: {}, revisions: {}, runs: {}, candidates: {}, verifications: {}, receipts: {}, sessions: {} });

export class Store {
  private s: State;
  private file: string | null;
  private writes = Promise.resolve();
  private readonly sealed = new WeakSet<object>();
  private readonly encodedHistory = new WeakMap<object, Buffer>();
  constructor(dataDir: string | null) {
    this.file = dataDir ? join(dataDir, "store.json") : null;
    if (this.file && existsSync(this.file)) this.s = JSON.parse(readFileSync(this.file, "utf8"));
    else this.s = empty();
    if (dataDir) mkdirSync(dataDir, { recursive: true });
    this.seal(this.s.revisions);
    this.seal(this.s.candidates);
    // 再起動前に実行中だった作業は結果不明として閉じる（後から届いても採用しない）
    for (const r of Object.values(this.s.runs))
      if (r.state === "running") {
        r.state = "failed";
        r.failure = "ホストの再起動で中断";
        r.finishedAt = Date.now();
      }
  }

  /** 古い版・候補を共有し、変更は作業用の表での置換・追記に限る。 */
  private seal(value: unknown): void {
    if (value === null || typeof value !== "object" || this.sealed.has(value)) return;
    this.sealed.add(value);
    for (const child of Object.values(value)) this.seal(child);
    Object.freeze(value);
  }

  private encode(key: string, value: unknown) {
    if (isHistory(key) && value && typeof value === "object") {
      const cached = this.encodedHistory.get(value);
      if (cached) return cached;
      const bytes = Buffer.from(JSON.stringify(value));
      this.encodedHistory.set(value, bytes);
      return bytes;
    }
    const json = JSON.stringify(value);
    return json === undefined ? undefined : Buffer.from(json);
  }

  private async flush(state: State) {
    if (!this.file) return;
    const tmp = this.file + ".tmp";
    const parts: Buffer[] = [Buffer.from("{")];
    for (const [key, value] of Object.entries(state)) {
      const bytes = this.encode(key, value);
      if (bytes) parts.push(Buffer.from(`${parts.length > 1 ? "," : ""}${JSON.stringify(key)}:`), bytes);
    }
    parts.push(Buffer.from("}"));
    const file = await open(tmp, "w");
    try {
      let index = 0;
      while (index < parts.length) {
        let { bytesWritten } = await file.writev(parts.slice(index));
        if (!bytesWritten) throw new Error("保存用ファイルへの書き込みが進みませんでした");
        while (index < parts.length && bytesWritten >= parts[index].length) bytesWritten -= parts[index++].length;
        if (bytesWritten) parts[index] = parts[index].subarray(bytesWritten);
      }
    } finally {
      await file.close();
    }
    await rename(tmp, this.file);
  }

  /** 最新版を照合する処理から永続化までを順番に行う。照合だけで終える操作もある。 */
  write<T>(operation: (commit: Commit) => T | Promise<T>): Promise<T> {
    const result = this.writes.then(() => operation(this.commit.bind(this)));
    this.writes = result.then(() => {}, () => {});
    return result;
  }

  idle(): Promise<void> {
    return this.writes;
  }

  /** 更新対象だけを複製し、ファイルの置換に成功してから公開する。 */
  private async commit<K extends Collection, T>(collections: readonly K[], fn: (s: Pick<State, K>) => T): Promise<T> {
    const next = { ...this.s };
    for (const key of collections) next[key] = isHistory(key) ? { ...this.s[key] } : structuredClone(this.s[key]);
    const r = fn(next);
    for (const key of collections) if (isHistory(key)) this.seal(next[key]);
    await this.flush(next);
    this.s = next;
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
  revisionsOf(artworkId: string): readonly Revision[] {
    return this.s.revisions[artworkId] ?? [];
  }
  receipt(owner: string, key: string): SaveReceipt | undefined {
    return this.s.receipts[owner + "\u0000" + key];
  }
  putReceipt(s: Pick<State, "receipts">, r: SaveReceipt) {
    s.receipts[r.owner + "\u0000" + r.key] = r;
  }
  nextGeneration(s: Pick<State, "sessions">, owner: string, session: string, artworkId: string): number {
    const k = [owner, session, artworkId].join("\u0000");
    s.sessions[k] = (s.sessions[k] ?? 0) + 1;
    return s.sessions[k];
  }
  pushRevision(s: Pick<State, "revisions">, r: Revision) {
    s.revisions[r.artworkId] = [...(s.revisions[r.artworkId] ?? []), r];
  }
}
