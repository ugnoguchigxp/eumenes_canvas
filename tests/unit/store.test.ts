import { expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/core/store";

test("ファイルへの部分書き込みを継続し、全データがそろってから確定する", async () => {
  const dir = mkdtempSync(join(tmpdir(), "canvas-short-write-"));
  const sample = await open(join(dir, "sample"), "w");
  const prototype = Object.getPrototypeOf(sample) as FileHandle;
  const writev = prototype.writev;
  await sample.close();
  let partial = false;
  const spy = spyOn(prototype, "writev").mockImplementation(async function <T extends readonly NodeJS.ArrayBufferView[]>(this: FileHandle, buffers: T, position?: number) {
    if (partial) {
      const { bytesWritten } = await writev.call(this, buffers, position);
      return { bytesWritten, buffers };
    }
    partial = true;
    const prefix = buffers[1];
    const { bytesWritten } = await writev.call(this, [buffers[0], new Uint8Array(prefix.buffer, prefix.byteOffset, 3)], position);
    return { bytesWritten, buffers };
  });
  try {
    const store = new Store(dir);
    const artwork = { id: "a", owner: "owner", title: "部分書き込みの試験", currentRevision: 1, createdAt: 1, updatedAt: 1 };
    await store.write((commit) => commit(["artworks"], (state) => { state.artworks.a = artwork; }));
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(new Store(dir).artworks.a).toEqual(artwork);
  } finally {
    spy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
});
