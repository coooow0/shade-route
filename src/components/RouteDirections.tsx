import { useEffect, useId, useState, type ReactNode } from "react";
import {
  buildWalkingDirections,
  type DirectionKind,
  type WalkingDirection,
} from "../domain/routing/directions";
import type { Place, RouteResult } from "../domain/routing/types";

interface RouteDirectionsProps {
  readonly route: RouteResult;
  readonly requestedAt: string;
  readonly goal: Place;
  readonly children?: ReactNode;
}

const DIRECTION_ICONS: Readonly<Record<DirectionKind, string>> = {
  depart: "↑",
  straight: "↑",
  "slight-left": "↖",
  left: "↰",
  "slight-right": "↗",
  right: "↱",
  "uturn-left": "↶",
  "uturn-right": "↷",
  connector: "⋯",
  steps: "≋",
  arrive: "●",
};

function walkMinutes(seconds: number) {
  return Math.max(1, Math.round(seconds / 60));
}

function distanceLabel(meters: number) {
  if (meters >= 1_000) return `${(meters / 1_000).toFixed(1)}km`;
  return `${Math.round(meters)}m`;
}

function stepDistanceLabel(meters: number) {
  if (meters >= 1_000) return `${(meters / 1_000).toFixed(1)}km`;
  return `${Math.max(10, Math.round(meters / 10) * 10)}m`;
}

function arrivalLabel(requestedAt: string, timeSec: number) {
  const arrival = new Date(new Date(requestedAt).getTime() + timeSec * 1_000);
  return `${new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "numeric",
    minute: "2-digit",
  }).format(arrival)} 도착`;
}

function exposureLabel(step: WalkingDirection) {
  if (step.exposure === "connector") return "접근 구간";
  if (step.exposure === "sun") return "햇빛 구간";
  return `예상 그늘 ${Math.round(step.shadeRatio * 100)}%`;
}

export default function RouteDirections({
  route,
  requestedAt,
  goal,
  children,
}: RouteDirectionsProps) {
  const headingId = useId();
  const listId = `${headingId}-list`;
  const [expanded, setExpanded] = useState(false);
  const directions = buildWalkingDirections(route.segments, goal.name);

  useEffect(() => {
    setExpanded(false);
  }, [route.pathKey]);

  return (
    <div className="route-guide">
      <div
        className="route-overview"
        role={directions.length > 0 ? "status" : undefined}
        aria-live={directions.length > 0 ? "polite" : undefined}
        aria-label={`${route.label} 경로, ${walkMinutes(route.timeSec)}분, ${directions.length}단계`}
      >
        <div>
          <strong>
            {walkMinutes(route.timeSec)}분 · {distanceLabel(route.lengthM)}
          </strong>
          <span>{arrivalLabel(requestedAt, route.timeSec)}</span>
        </div>
        <em>예상 그늘 {Math.round(route.shadeRatio * 100)}%</em>
      </div>

      {children}

      <section className="route-directions" aria-labelledby={headingId}>
        <div className="directions-heading">
          <h3 id={headingId}>상세 경로</h3>
          {directions.length > 0 && <span>{directions.length}단계</span>}
        </div>
        {directions.length === 0 ? (
          <p className="directions-empty" role="status">
            상세 경로 안내를 만들 수 없어요.
          </p>
        ) : (
          <ol id={listId} aria-label="도보 경로 안내" hidden={!expanded}>
            {directions.map((step) => (
              <li
                key={step.id}
                className={`direction-step ${step.kind}`}
                aria-posinset={
                  directions.findIndex((item) => item.id === step.id) + 1
                }
                aria-setsize={directions.length}
              >
                <span className="direction-icon" aria-hidden="true">
                  {DIRECTION_ICONS[step.kind]}
                </span>
                <div>
                  <strong>{step.instruction}</strong>
                  {step.kind !== "arrive" && (
                    <span className="direction-meta">
                      <b>{stepDistanceLabel(step.distanceM)}</b>
                      <em className={`exposure-${step.exposure}`}>
                        {exposureLabel(step)}
                      </em>
                      {step.hasSteps && step.kind !== "steps" && (
                        <em>계단 포함</em>
                      )}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
        {directions.length > 0 && (
          <button
            className="directions-toggle"
            type="button"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded
              ? "상세 경로 접기"
              : `상세 경로 ${directions.length}단계 보기`}
          </button>
        )}
      </section>
    </div>
  );
}
