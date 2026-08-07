import { useCallback, useEffect, useId, useRef, useState } from "react";
import { APP_VERSION } from "../appVersion";
import {
  trackRouteFeedbackImpression,
  trackRouteFeedbackSelect,
  trackRouteFeedbackSubmit,
} from "../domain/analytics/routeAnalytics";
import {
  MAX_FEEDBACK_CITY_LENGTH,
  MAX_FEEDBACK_MEMO_LENGTH,
  submitRouteFeedback,
  type Satisfaction,
} from "../domain/feedback/feedbackClient";
import type { RouteResult } from "../domain/routing/types";

interface RouteFeedbackProps {
  readonly route: RouteResult;
  readonly requestedAt: string;
  readonly webhookUrl: string;
  readonly submit?: typeof submitRouteFeedback;
  readonly storage?: Storage;
  readonly now?: () => Date;
  readonly onDetailOpen?: () => void;
}

type Phase = "picking" | "detailing" | "sending" | "done" | "error";

const SATISFACTION_OPTIONS: ReadonlyArray<{
  readonly value: Satisfaction;
  readonly label: string;
}> = [
  { value: "good", label: "좋음" },
  { value: "mid", label: "보통" },
  { value: "bad", label: "나쁨" },
];

const STORAGE_KEY_PREFIX = "shade-route:feedback:";

function storageKey(pathKey: string) {
  return `${STORAGE_KEY_PREFIX}${pathKey}`;
}

// Storage 사용은 이 위젯의 부가 기능이다. 저장소가 없거나 (private mode, WebView 정책),
// getItem/setItem이 함수가 아니거나 (테스트에서 부분 mock), 저장 시 예외를 던지면 (quota),
// 위젯은 저장 없이 그대로 동작해야 한다. dedupe만 못할 뿐 UI는 정상.
function isUsableStorage(candidate: unknown): candidate is Storage {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof (candidate as Storage).getItem === "function" &&
    typeof (candidate as Storage).setItem === "function"
  );
}

function getStorage(explicit?: Storage): Storage | null {
  if (explicit !== undefined)
    return isUsableStorage(explicit) ? explicit : null;
  try {
    if (typeof window === "undefined") return null;
    const candidate = window.localStorage;
    return isUsableStorage(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function safeGetItem(store: Storage | null, key: string): string | null {
  if (!store) return null;
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(store: Storage | null, key: string, value: string): void {
  if (!store) return;
  try {
    store.setItem(key, value);
  } catch {
    // 저장 실패는 무시. 이번 세션에서 dedupe만 놓칠 뿐이다.
  }
}

export default function RouteFeedback({
  route,
  requestedAt,
  webhookUrl,
  submit = submitRouteFeedback,
  storage,
  now = () => new Date(),
  onDetailOpen,
}: RouteFeedbackProps) {
  const headingId = useId();
  const memoId = `${headingId}-memo`;
  const cityId = `${headingId}-city`;
  const store = getStorage(storage);
  const alreadySubmitted = Boolean(
    safeGetItem(store, storageKey(route.pathKey)),
  );
  const [phase, setPhase] = useState<Phase>(() =>
    alreadySubmitted ? "done" : "picking",
  );
  const [satisfaction, setSatisfaction] = useState<Satisfaction | null>(null);
  const [memo, setMemo] = useState("");
  const [wantedCity, setWantedCity] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const feedbackElement = useRef<HTMLElement | null>(null);
  const recordedImpressions = useRef<ReadonlySet<string>>(new Set());
  const impressionKey = `${requestedAt}:${route.pathKey}`;

  const recordImpression = useCallback(() => {
    if (alreadySubmitted || recordedImpressions.current.has(impressionKey)) {
      return;
    }
    recordedImpressions.current = new Set([
      ...recordedImpressions.current,
      impressionKey,
    ]);
    trackRouteFeedbackImpression(route.mode);
  }, [alreadySubmitted, impressionKey, route.mode]);

  useEffect(() => {
    if (alreadySubmitted) {
      setPhase("done");
      return;
    }
    setPhase("picking");
    setSatisfaction(null);
    setMemo("");
    setWantedCity("");
    setErrorMessage(null);
  }, [alreadySubmitted, requestedAt, route.pathKey]);

  useEffect(() => {
    const element = feedbackElement.current;
    if (
      phase === "done" ||
      alreadySubmitted ||
      recordedImpressions.current.has(impressionKey) ||
      element === null
    ) {
      return undefined;
    }
    if (typeof IntersectionObserver === "undefined") {
      recordImpression();
      return undefined;
    }
    let active = true;
    const observer = new IntersectionObserver((entries) => {
      if (!active || !entries.some((entry) => entry.isIntersecting)) return;
      recordImpression();
      observer.disconnect();
    });
    observer.observe(element);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [alreadySubmitted, impressionKey, phase, recordImpression]);

  const pickSatisfaction = (value: Satisfaction) => {
    recordImpression();
    if (satisfaction !== value) {
      trackRouteFeedbackSelect(route.mode, value);
    }
    onDetailOpen?.();
    setSatisfaction(value);
    setErrorMessage(null);
    setPhase("detailing");
  };

  const sendFeedback = async () => {
    if (satisfaction === null) return;
    setPhase("sending");
    setErrorMessage(null);
    try {
      await submit(
        {
          satisfaction,
          memo: memo.trim() || undefined,
          wantedCity: wantedCity.trim() || undefined,
          routeMode: route.mode,
          timeSec: route.timeSec,
          lengthM: route.lengthM,
          sunSec: route.sunSec,
          shadeRatio: route.shadeRatio,
          requestedAt,
          submittedAt: now().toISOString(),
          appVersion: APP_VERSION,
        },
        { webhookUrl },
      );
      trackRouteFeedbackSubmit(route.mode, satisfaction);
      safeSetItem(store, storageKey(route.pathKey), now().toISOString());
      setPhase("done");
    } catch {
      setErrorMessage("피드백을 보내지 못했어요. 잠시 후 다시 시도해 주세요.");
      setPhase("error");
    }
  };

  const cancelDetailing = () => {
    setPhase("picking");
    setSatisfaction(null);
    setMemo("");
    setWantedCity("");
    setErrorMessage(null);
  };

  if (phase === "done") {
    return (
      <section
        className="route-feedback done"
        aria-labelledby={headingId}
        data-sheet-peek-end
      >
        <p id={headingId}>
          <strong>피드백 고마워요.</strong> 다음 경로 계산에 반영할게요.
        </p>
      </section>
    );
  }

  const showsDetails =
    phase === "detailing" || phase === "sending" || phase === "error";

  return (
    <section
      ref={feedbackElement}
      className="route-feedback"
      aria-labelledby={headingId}
    >
      <div className="route-feedback-heading">
        <h3 id={headingId}>이 경로가 실제와 얼마나 맞았어요?</h3>
        <p>예상 그늘과 실제 체감을 비교해 알려주세요.</p>
      </div>

      <div
        className="route-feedback-choices"
        role="group"
        aria-label="정확도 만족도"
        data-sheet-peek-end
      >
        {SATISFACTION_OPTIONS.map((option) => {
          const selected = satisfaction === option.value;
          return (
            <button
              key={option.value}
              type="button"
              className={
                selected
                  ? "route-feedback-choice selected"
                  : "route-feedback-choice"
              }
              aria-pressed={selected}
              disabled={phase === "sending"}
              onClick={() => pickSatisfaction(option.value)}
            >
              <strong>{option.label}</strong>
            </button>
          );
        })}
      </div>

      {showsDetails && (
        <>
          <div className="route-feedback-form">
            <label htmlFor={memoId}>
              무엇이 달랐나요? <em>(선택)</em>
            </label>
            <textarea
              id={memoId}
              rows={3}
              maxLength={MAX_FEEDBACK_MEMO_LENGTH}
              value={memo}
              disabled={phase === "sending"}
              onChange={(event) => setMemo(event.target.value)}
              placeholder="예: 오후 4시라 실제로는 그늘이 더 많았어요"
            />

            <label htmlFor={cityId}>
              다른 도시도 원해요? <em>(선택)</em>
            </label>
            <input
              id={cityId}
              type="text"
              maxLength={MAX_FEEDBACK_CITY_LENGTH}
              value={wantedCity}
              disabled={phase === "sending"}
              onChange={(event) => setWantedCity(event.target.value)}
              placeholder="예: 부산, 대구"
            />

            {errorMessage && (
              <p className="route-feedback-error" role="alert">
                {errorMessage}
              </p>
            )}

            <div className="route-feedback-actions">
              <button
                type="button"
                className="route-feedback-cancel"
                disabled={phase === "sending"}
                onClick={cancelDetailing}
              >
                취소
              </button>
              <button
                type="button"
                className="route-feedback-submit"
                disabled={phase === "sending"}
                onClick={() => void sendFeedback()}
              >
                {phase === "sending" ? "보내는 중" : "보내기"}
              </button>
            </div>
          </div>

          <p className="route-feedback-privacy">
            만족도·경로 지표·자유 메모만 보내요. 좌표·검색어·계정 정보는 보내지
            않아요.
          </p>
        </>
      )}
    </section>
  );
}
