import { describe, expect, it, vi } from "vitest";
import {
  MAX_FEEDBACK_CITY_LENGTH,
  MAX_FEEDBACK_MEMO_LENGTH,
  submitRouteFeedback,
  type RouteFeedbackSubmission,
} from "./feedbackClient";

const baseSubmission: RouteFeedbackSubmission = {
  satisfaction: "good",
  routeMode: "balanced",
  timeSec: 720,
  lengthM: 880,
  sunSec: 240,
  shadeRatio: 0.62,
  requestedAt: "2026-07-25T08:00:00.000Z",
  submittedAt: "2026-07-25T08:00:12.000Z",
  appVersion: "0.1.0",
};

const WEBHOOK = "https://example.com/webhook";

function okResponse() {
  return new Response("ok", { status: 200 });
}

describe("submitRouteFeedback", () => {
  it("posts the submission as JSON text without triggering CORS preflight", async () => {
    const fetcher = vi.fn().mockResolvedValue(okResponse());

    await submitRouteFeedback(baseSubmission, {
      webhookUrl: WEBHOOK,
      fetcher: fetcher as unknown as typeof fetch,
    });

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(WEBHOOK);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "Content-Type": "text/plain;charset=utf-8" });
    expect(JSON.parse(String(init?.body))).toEqual(baseSubmission);
  });

  it("throws FEEDBACK_SUBMIT_FAILED on non-2xx response", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response("nope", { status: 500 }));

    await expect(
      submitRouteFeedback(baseSubmission, {
        webhookUrl: WEBHOOK,
        fetcher: fetcher as unknown as typeof fetch,
      }),
    ).rejects.toThrow("FEEDBACK_SUBMIT_FAILED");
  });

  it("throws FEEDBACK_SUBMIT_FAILED on network error", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("network down"));

    await expect(
      submitRouteFeedback(baseSubmission, {
        webhookUrl: WEBHOOK,
        fetcher: fetcher as unknown as typeof fetch,
      }),
    ).rejects.toThrow("FEEDBACK_SUBMIT_FAILED");
  });

  it("aborts and throws FEEDBACK_ABORTED when the caller signal aborts", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );

    const promise = submitRouteFeedback(baseSubmission, {
      webhookUrl: WEBHOOK,
      fetcher: fetcher as unknown as typeof fetch,
      signal: controller.signal,
    });
    controller.abort();

    await expect(promise).rejects.toThrow("FEEDBACK_ABORTED");
  });

  it("throws FEEDBACK_ABORTED immediately if the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn();

    await expect(
      submitRouteFeedback(baseSubmission, {
        webhookUrl: WEBHOOK,
        fetcher: fetcher as unknown as typeof fetch,
        signal: controller.signal,
      }),
    ).rejects.toThrow("FEEDBACK_ABORTED");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects an overly long memo before hitting the network", async () => {
    const fetcher = vi.fn().mockResolvedValue(okResponse());

    await expect(
      submitRouteFeedback(
        { ...baseSubmission, memo: "x".repeat(MAX_FEEDBACK_MEMO_LENGTH + 1) },
        { webhookUrl: WEBHOOK, fetcher: fetcher as unknown as typeof fetch },
      ),
    ).rejects.toThrow("FEEDBACK_MEMO_TOO_LONG");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects an overly long wantedCity before hitting the network", async () => {
    const fetcher = vi.fn().mockResolvedValue(okResponse());

    await expect(
      submitRouteFeedback(
        {
          ...baseSubmission,
          wantedCity: "부".repeat(MAX_FEEDBACK_CITY_LENGTH + 1),
        },
        { webhookUrl: WEBHOOK, fetcher: fetcher as unknown as typeof fetch },
      ),
    ).rejects.toThrow("FEEDBACK_CITY_TOO_LONG");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
