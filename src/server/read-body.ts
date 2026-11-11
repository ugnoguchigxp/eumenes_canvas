export class BodyLimitError extends Error {}

/** UTF-8 の本文を、読み込み中のバイト数と取消で制限する。 */
export async function readBoundedText(message: Pick<Request, "body" | "headers">, maxBytes: number, signal?: AbortSignal): Promise<string> {
  if (Number(message.headers.get("content-length")) > maxBytes) {
    void message.body?.cancel().catch(() => {});
    throw new BodyLimitError();
  }
  const reader = message.body?.getReader();
  if (!reader) {
    signal?.throwIfAborted();
    return "";
  }
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let received = 0;
  try {
    if (signal?.aborted) abort();
    signal?.throwIfAborted();
    for (;;) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        abort();
        throw new BodyLimitError();
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  chunks.push(decoder.decode());
  return chunks.join("");
}
