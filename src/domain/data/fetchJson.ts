interface FetchJsonWithLimitOptions {
  readonly fetcher: typeof fetch;
  readonly url: string;
  readonly maxBytes: number;
  readonly loadError: string;
  readonly invalidError: string;
  readonly timeoutMs?: number;
}

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
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > maxBytes) {
      throw codedError(invalidError);
    }
    return body;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let body = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    totalBytes += chunk.value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw codedError(invalidError);
    }
    body += decoder.decode(chunk.value, { stream: true });
  }
  return body + decoder.decode();
}

export async function fetchJsonWithLimit({
  fetcher,
  url,
  maxBytes,
  loadError,
  invalidError,
  timeoutMs = 10_000,
}: FetchJsonWithLimitOptions): Promise<unknown> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetcher(url, { signal: controller.signal });
    } catch {
      throw codedError(loadError);
    }
    if (!response.ok) throw codedError(loadError);
    const declaredBytes = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      throw codedError(invalidError);
    }

    let body: string;
    try {
      body = await readLimitedText(response, maxBytes, invalidError);
    } catch (error) {
      if (hasCode(error, invalidError)) throw error;
      throw codedError(loadError);
    }
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw codedError(invalidError);
    }
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
