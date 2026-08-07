import type { Place, RouteMode, RouteResult } from "../domain/routing/types";
import { ribbonParts } from "./routeRibbon";
import { sunMinutes, walkMinutes } from "./routeSummary";

interface RouteRibbonsProps {
  readonly routes: readonly RouteResult[];
  readonly selectedMode: RouteMode;
  readonly recommendedMode: RouteMode;
  readonly start: Place;
  readonly goal: Place;
  readonly busy: boolean;
  readonly onSelect: (mode: RouteMode) => void;
}

export default function RouteRibbons({
  routes,
  selectedMode,
  recommendedMode,
  start,
  goal,
  busy,
  onSelect,
}: RouteRibbonsProps) {
  return (
    <div className="route-ribbons">
      <p className="ribbon-legend">
        <span>어느 구간에서 햇빛을 받는지 한눈에</span>
        <span className="ribbon-legend-keys">
          <b className="key-shade">그늘</b>
          <b className="key-sun">햇빛</b>
        </span>
      </p>

      <div
        id="route-sheet-metrics"
        className="ribbon-cards"
        role="group"
        aria-label="경로 선택 및 세 경로 비교"
      >
        {routes.map((route) => {
          const selected = route.mode === selectedMode;
          const parts = ribbonParts(route);
          const total = parts.reduce((sum, part) => sum + part.meters, 0);
          const minutes = walkMinutes(route.timeSec);
          const sun = sunMinutes(route.sunSec);
          return (
            <button
              key={route.mode}
              type="button"
              className={selected ? "ribbon-card selected" : "ribbon-card"}
              aria-label={`${route.label} 경로 선택 · ${minutes}분 · 햇빛 ${sun}분`}
              aria-pressed={selected}
              disabled={busy}
              onClick={() => onSelect(route.mode)}
            >
              <span className="ribbon-card-head" aria-hidden="true">
                <span className="ribbon-card-name">
                  {route.label}
                  {route.mode === recommendedMode && <em>추천</em>}
                  {selected && <i>· 선택됨</i>}
                </span>
                <span className="ribbon-card-metric">
                  <b>{minutes}분</b> · 햇빛 {sun}분
                </span>
              </span>

              <span className="ribbon-track" aria-hidden="true">
                {total > 0 ? (
                  parts.map((part, index) => (
                    <i
                      key={index}
                      className={`ribbon-part ${part.kind}`}
                      style={{ width: `${(part.meters / total) * 100}%` }}
                    />
                  ))
                ) : (
                  <i
                    className="ribbon-part connector"
                    style={{ width: "100%" }}
                  />
                )}
              </span>

              {selected && (
                <span className="ribbon-waypoints" aria-hidden="true">
                  <span>{start.name}</span>
                  <span>{goal.name}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      <p className="ribbon-note" data-sheet-peek-end>
        경로를 누르면 지도에 해당 경로가 표시돼요 · 건물 데이터와 출발 시각을
        기준으로 계산한 예상치예요.
      </p>
    </div>
  );
}
