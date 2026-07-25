import { useEffect, useId, useState } from "react";
import { APP_VERSION } from "../appVersion";
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
}

type Phase = "picking" | "detailing" | "sending" | "done" | "error";

const SATISFACTION_OPTIONS: ReadonlyArray<{
  readonly value: Satisfaction;
  readonly label: string;
  readonly hint: string;
}> = [
  { value: "good", label: "좋음", hint: "예상 그늘과 비슷했어요" },
  { value: "mid", label: "보통", hint: "일부만 맞았어요" },
  { value: "bad", label: "나쁨", hint: "예상과 많이 달랐어요" },
];

const STORAGE_KEY_PREFIX = "shade-route:feedback:";

function storageKey(pathKey: string) {
  return `${STORAGE_KEY_PREFIX}${pathKey}`;
}

function getStorage(explicit?: Storage): Storage | null {
  if (explicit) return explicit;
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export default function RouteFeedback({
  route,
  requestedAt,
  webhookUrl,
  submit = submitRouteFeedback,
  storage,
  now = () => new Date(),
}: RouteFeedbackProps) {
  const headingId = useId();
  const memoId = `${headingId}-memo`;
  const cityId = `${headingId}-city`;
  const store = getStorage(storage);
  const [phase, setPhase] = useState<Phase>(() =>
    store?.getItem(storageKey(route.pathKey)) ? "done" : "picking",
  );
  const [satisfaction, setSatisfaction] = useState<Satisfaction | null>(null);
  const [memo, setMemo] = useState("");
  const [wantedCity, setWantedCity] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (store?.getItem(storageKey(route.pathKey))) {
      setPhase("done");
      return;
    }
    setPhase("picking");
    setSatisfaction(null);
    setMemo("");
    setWantedCity("");
    setErrorMessage(null);
  }, [route.pathKey, store]);

  const pickSatisfaction = (value: Satisfaction) => {
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
      store?.setItem(storageKey(route.pathKey), now().toISOString());
      setPhase("done");
    } catch {
      setErrorMessage(
        "피드백을 보내지 못했어요. 잠시 후 다시 시도해 주세요.",
      );
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
      <section className="route-feedback done" aria-labelledby={headingId}>
        <p id={headingId}>
          <strong>피드백 고마워요.</strong> 다음 경로 계산에 반영할게요.
        </p>
      </section>
    );
  }

  return (
    <section className="route-feedback" aria-labelledby={headingId}>
      <div className="route-feedback-heading">
        <h3 id={headingId}>이 경로가 실제와 얼마나 맞았어요?</h3>
        <p>예상 그늘과 실제 체감을 비교해 알려주세요.</p>
      </div>

      <div
        className="route-feedback-choices"
        role="group"
        aria-label="정확도 만족도"
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
              <span>{option.hint}</span>
            </button>
          );
        })}
      </div>

      {(phase === "detailing" ||
        phase === "sending" ||
        phase === "error") && (
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
      )}

      <p className="route-feedback-privacy">
        만족도·경로 지표·자유 메모만 보내요. 좌표·검색어·계정 정보는 보내지
        않아요.
      </p>
    </section>
  );
}
