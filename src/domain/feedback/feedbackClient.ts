import type { RouteMode } from "../routing/types";

export type Satisfaction = "good" | "mid" | "bad";

export const MAX_FEEDBACK_MEMO_LENGTH = 500;
export const MAX_FEEDBACK_CITY_LENGTH = 60;

export interface RouteFeedbackSubmission {
  readonly satisfaction: Satisfaction;
  readonly memo?: string;
  readonly wantedCity?: string;
  readonly routeMode: RouteMode;
  readonly timeSec: number;
  readonly lengthM: number;
  readonly sunSec: number;
  readonly shadeRatio: number;
  readonly requestedAt: string;
  readonly submittedAt: string;
  readonly appVersion: string;
}

export interface SubmitRouteFeedbackOptions {
  readonly webhookUrl: string;
  readonly fetcher?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

function codedError(code: string) {
  return new Error(code);
}

export async function submitRouteFeedback(
  submission: RouteFeedbackSubmission,
  {
    webhookUrl,
    fetcher = fetch,
    signal,
    timeoutMs = 6_000,
  }: SubmitRouteFeedbackOptions,
): Promise<void> {
  if (submission.memo && submission.memo.length > MAX_FEEDBACK_MEMO_LENGTH) {
    throw codedError("FEEDBACK_MEMO_TOO_LONG");
  }
  if (
    submission.wantedCity &&
    submission.wantedCity.length > MAX_FEEDBACK_CITY_LENGTH
  ) {
    throw codedError("FEEDBACK_CITY_TOO_LONG");
  }

  const controller = new AbortController();
  if (signal?.aborted) throw codedError("FEEDBACK_ABORTED");
  const relayAbort = () => controller.abort();
  signal?.addEventListener("abort", relayAbort, { once: true });
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetcher(webhookUrl, {
        method: "POST",
        // text/plain avoids CORS preflight so Apps Script `doPost` can respond
        // directly. The server reads e.postData.contents as JSON.
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(submission),
        signal: controller.signal,
      });
    } catch {
      if (signal?.aborted) throw codedError("FEEDBACK_ABORTED");
      throw codedError("FEEDBACK_SUBMIT_FAILED");
    }
    if (!response.ok) throw codedError("FEEDBACK_SUBMIT_FAILED");
  } finally {
    globalThis.clearTimeout(timeout);
    signal?.removeEventListener("abort", relayAbort);
  }
}
