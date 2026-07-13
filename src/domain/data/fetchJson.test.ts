import { describe, expect, it, vi } from "vitest";
import { fetchJsonWithLimit } from "./fetchJson";

describe("fetchJsonWithLimit", () => {
  it("parses a response within the byte budget", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{"ok":true}'));

    await expect(
      fetchJsonWithLimit({
        fetcher,
        url: "/data.json",
        maxBytes: 100,
        loadError: "LOAD_FAILED",
        invalidError: "INVALID_DATA",
      }),
    ).resolves.toEqual({ ok: true });
  });

  it("stops reading a streamed response as soon as it exceeds the budget", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("12345"));
        controller.enqueue(new TextEncoder().encode("67890"));
        controller.close();
      },
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(body));

    await expect(
      fetchJsonWithLimit({
        fetcher,
        url: "/large.json",
        maxBytes: 8,
        loadError: "LOAD_FAILED",
        invalidError: "INVALID_DATA",
      }),
    ).rejects.toThrow("INVALID_DATA");
  });

  it("aborts a stalled request", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>((_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    );
    const request = fetchJsonWithLimit({
      fetcher,
      url: "/slow.json",
      maxBytes: 100,
      loadError: "LOAD_FAILED",
      invalidError: "INVALID_DATA",
      timeoutMs: 1_000,
    });
    const rejection = expect(request).rejects.toThrow("LOAD_FAILED");

    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;
    vi.useRealTimers();
  });
});
