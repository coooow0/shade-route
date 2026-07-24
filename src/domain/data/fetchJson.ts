interface FetchJsonWithLimitOptions {
  readonly fetcher: typeof fetch;
  readonly url: string;
  readonly maxBytes: number;
  readonly loadError: string;
  readonly invalidError: string;
  readonly timeoutMs?: number;
  readonly onBytes?: (bytes: number) => void;
  readonly expectedSha256?: string;
  readonly integrityError?: string;
  readonly signal?: AbortSignal;
  readonly abortError?: string;
}

import { assertSha256Integrity } from "./integrity";

function codedError(code: string) {
  return new Error(code);
}

function hasCode(error: unknown, code: string) {
  return error instanceof Error && error.message === code;
}

async function readLimitedText(
  response: Response,
  maxBytes: number,
  invalidError: string,
) {
  if (!response.body) {
    const raw = new Uint8Array(await response.arrayBuffer());
    if (raw.byteLength > maxBytes) {
      throw codedError(invalidError);
    }
    return {
      body: new TextDecoder().decode(raw),
      bytes: raw.byteLength,
      raw,
    };
  }

  const reader = response.body.getReader();
  let totalBytes = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    totalBytes += chunk.value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw codedError(invalidError);
    }
    chunks.push(chunk.value);
  }
  const raw = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    raw.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    body: new TextDecoder().decode(raw),
    bytes: totalBytes,
    raw,
  };
}

export async function fetchJsonWithLimit({
  fetcher,
  url,
  maxBytes,
  loadError,
  invalidError,
  timeoutMs = 10_000,
  onBytes,
  expectedSha256,
  integrityError = invalidError,
  signal,
  abortError = loadError,
}: FetchJsonWithLimitOptions): Promise<unknown> {
  const controller = new AbortController();
  const relayAbort = () => controller.abort();
  if (signal?.aborted) throw codedError(abortError);
  signal?.addEventListener("abort", relayAbort, { once: true });
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetcher(url, { signal: controller.signal });
    } catch {
      if (signal?.aborted) throw codedError(abortError);
      throw codedError(loadError);
    }
    if (!response.ok) throw codedError(loadError);
    const declaredBytes = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      throw codedError(invalidError);
    }

    let body: string;
    let bytes: number;
    let raw: Uint8Array;
    try {
      ({ body, bytes, raw } = await readLimitedText(
        response,
        maxBytes,
        invalidError,
      ));
    } catch (error) {
      if (signal?.aborted) throw codedError(abortError);
      if (hasCode(error, invalidError)) throw error;
      throw codedError(loadError);
    }
    onBytes?.(bytes);
    if (expectedSha256 !== undefined) {
      await assertSha256Integrity(raw, expectedSha256, integrityError);
    }
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw codedError(invalidError);
    }
  } finally {
    globalThis.clearTimeout(timeout);
    signal?.removeEventListener("abort", relayAbort);
  }
}
