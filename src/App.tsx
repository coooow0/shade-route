import { Top } from "@toss/tds-mobile";
import { useCallback, useEffect, useRef, useState } from "react";
import PlaceCombobox from "./components/PlaceCombobox";
import ResultSheetHandle from "./components/ResultSheetHandle";
import RouteDirections from "./components/RouteDirections";
import RouteFeedback from "./components/RouteFeedback";
import RouteMap from "./components/RouteMap";
import WeatherBanner from "./components/WeatherBanner";
import {
  distanceLabel,
  routeByMode,
  sunMinutes,
  walkMinutes,
} from "./components/routeSummary";
import { useResultSheetMotion } from "./components/useResultSheetMotion";
import {
  CurrentLocationError,
  requestCurrentLocationPermission,
  resolveCurrentPlace,
} from "./domain/location/currentLocation";
import { loadSeoulPlaces } from "./domain/places/loadSeoulPlaces";
import {
  loadCurrentWeather,
  weatherGuidance,
  type CurrentWeather,
} from "./domain/weather/currentWeather";
import { PLACES } from "./domain/routing/routeService";
import { calculateRouteBundleForPlaces } from "./domain/routing/routeWorkerClient";
import type { Place, RouteBundle, RouteMode } from "./domain/routing/types";
import "./App.css";

const TIME_OPTIONS = [
  { label: "지금", minutes: 0 },
  { label: "30분 뒤", minutes: 30 },
  { label: "1시간 뒤", minutes: 60 },
] as const;

const SEOUL_WEATHER_LOCATION = { lat: 37.5665, lon: 126.978 } as const;

// Read per render so tests can toggle the env via `vi.stubEnv` and so that Vitest
// picks up whatever `.env.local` holds without freezing the value at import time.
function readFeedbackWebhookUrl(): string {
  return import.meta.env.VITE_FEEDBACK_WEBHOOK_URL ?? "";
}

function mergePlaces(stations: readonly Place[]) {
  return [
    ...new Map(
      [...PLACES, ...stations].map((place) => [place.id, place] as const),
    ).values(),
  ];
}

interface LocationNotice {
  readonly tone: "success" | "error";
  readonly message: string;
  readonly action?: "request-permission";
}

function locationErrorMessage(error: unknown) {
  if (!(error instanceof CurrentLocationError)) {
    return "현재 위치를 가져오지 못했어요. 잠시 후 다시 시도해 주세요.";
  }
  if (error.code === "OUTSIDE_SEOUL") {
    return "현재 위치는 서울 밖이에요. 선택한 출발지를 유지했어요.";
  }
  if (error.code === "LOCATION_PERMISSION_DENIED") {
    return "위치 권한을 허용하면 현재 위치에서 출발할 수 있어요.";
  }
  if (error.code === "LOCATION_LOW_ACCURACY") {
    return "위치 오차가 커요. 잠시 후 하늘이 잘 보이는 곳에서 다시 시도해 주세요.";
  }
  return "현재 위치를 가져오지 못했어요. 샌드박스 앱에서 다시 시도해 주세요.";
}

function App() {
  const [startId, setStartId] = useState(PLACES[0].id);
  const [goalId, setGoalId] = useState(PLACES[1].id);
  const [places, setPlaces] = useState<readonly Place[]>(PLACES);
  const [placeLoadState, setPlaceLoadState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [placeLoadAttempt, setPlaceLoadAttempt] = useState(0);
  const [weather, setWeather] = useState<CurrentWeather | null>(null);
  const [weatherStatus, setWeatherStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [weatherAttempt, setWeatherAttempt] = useState(0);
  const [currentPlace, setCurrentPlace] = useState<Place | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationNotice, setLocationNotice] = useState<LocationNotice | null>(
    null,
  );
  const [offsetMinutes, setOffsetMinutes] = useState(0);
  const [startEditing, setStartEditing] = useState(false);
  const [goalEditing, setGoalEditing] = useState(false);
  const [bundle, setBundle] = useState<RouteBundle | null>(null);
  const [selectedMode, setSelectedMode] = useState<RouteMode>("balanced");
  const resultSheetMotion = useResultSheetMotion();
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [routeError, setRouteError] = useState<
    | "generic"
    | "near-goal"
    | "off-network"
    | "too-long"
    | "outside-seoul"
    | "complex-data"
  >("generic");
  const latestRequest = useRef(0);
  const activeRouteController = useRef<AbortController | null>(null);
  const latestLocationRequest = useRef(0);
  const resultSheet = useRef<HTMLElement | null>(null);
  const getResultSheet = useCallback(() => resultSheet.current, []);

  const busy = status === "loading" || locating;
  const hasUncommittedSearch = startEditing || goalEditing;
  const feedbackWebhookUrl = readFeedbackWebhookUrl();
  useEffect(() => {
    let active = true;
    setPlaceLoadState("loading");
    void loadSeoulPlaces()
      .then((stations) => {
        if (!active) return;
        setPlaces(mergePlaces(stations));
        setPlaceLoadState("ready");
      })
      .catch(() => {
        if (active) setPlaceLoadState("error");
      });
    return () => {
      active = false;
    };
  }, [placeLoadAttempt]);

  const startOptions = currentPlace ? [currentPlace, ...places] : places;
  const selectedStart =
    (currentPlace?.id === startId ? currentPlace : null) ??
    places.find((place) => place.id === startId);
  const selectedGoal = places.find((place) => place.id === goalId);
  useEffect(() => {
    let active = true;
    setWeather(null);
    setWeatherStatus("loading");
    void loadCurrentWeather(SEOUL_WEATHER_LOCATION)
      .then((nextWeather) => {
        if (!active) return;
        setWeather(nextWeather);
        setWeatherStatus("ready");
      })
      .catch(() => {
        if (!active) return;
        setWeather(null);
        setWeatherStatus("error");
      });
    return () => {
      active = false;
    };
  }, [weatherAttempt]);

  useEffect(() => {
    const cancelActiveRoute = () => {
      const controller = activeRouteController.current;
      if (!controller) return false;
      latestRequest.current += 1;
      controller.abort();
      activeRouteController.current = null;
      return true;
    };
    const handlePageHide = () => {
      if (!cancelActiveRoute()) return;
      setBundle(null);
      setStatus("idle");
      setRouteError("generic");
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") handlePageHide();
    };

    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelActiveRoute();
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const invalidateResult = () => {
    latestRequest.current += 1;
    activeRouteController.current?.abort();
    activeRouteController.current = null;
    setBundle(null);
    setStatus("idle");
    setRouteError("generic");
  };

  const runSearch = async (offset = offsetMinutes) => {
    if (
      hasUncommittedSearch ||
      startId === goalId ||
      !selectedStart ||
      !selectedGoal
    ) {
      setStatus("error");
      return;
    }
    activeRouteController.current?.abort();
    const controller = new AbortController();
    activeRouteController.current = controller;
    const requestId = ++latestRequest.current;
    setStatus("loading");
    setRouteError("generic");
    try {
      const result = await calculateRouteBundleForPlaces(
        {
          start: selectedStart,
          goal: selectedGoal,
          offsetMinutes: offset,
        },
        { signal: controller.signal },
      );
      if (requestId !== latestRequest.current || controller.signal.aborted)
        return;
      resultSheetMotion.expand();
      setBundle(result);
      setSelectedMode((current) =>
        result.routes.some((route) => route.mode === current)
          ? current
          : routeByMode(result.routes, "balanced").mode,
      );
      setStatus("success");
    } catch (error) {
      if (requestId !== latestRequest.current || controller.signal.aborted)
        return;
      setBundle(null);
      const errorMessage = error instanceof Error ? error.message : "";
      setRouteError(
        errorMessage === "ALREADY_NEAR_GOAL"
          ? "near-goal"
          : errorMessage === "ROUTE_TOO_LONG"
            ? "too-long"
            : errorMessage === "OUTSIDE_SEOUL"
              ? "outside-seoul"
              : errorMessage === "ROUTE_DATA_TOO_COMPLEX"
                ? "complex-data"
                : errorMessage === "SNAP_FAILED" ||
                    errorMessage === "ROUTE_NOT_FOUND"
                  ? "off-network"
                  : "generic",
      );
      setStatus("error");
    } finally {
      if (activeRouteController.current === controller) {
        activeRouteController.current = null;
      }
    }
  };

  const selectTime = (nextOffset: number) => {
    if (busy) return;
    setOffsetMinutes(nextOffset);
    if (bundle) void runSearch(nextOffset);
  };

  const swapPlaces = () => {
    if (busy || startId === currentPlace?.id) return;
    setStartId(goalId);
    setGoalId(startId);
    invalidateResult();
  };

  const selectStartPlace = (place: Place) => {
    setStartEditing(false);
    setStartId(place.id);
    if (currentPlace !== null && place.id !== currentPlace.id) {
      setCurrentPlace(null);
    }
    setLocationNotice(null);
    invalidateResult();
  };

  const selectGoalPlace = (place: Place) => {
    setGoalEditing(false);
    setGoalId(place.id);
    setLocationNotice(null);
    invalidateResult();
  };

  const handleCurrentLocation = async () => {
    if (busy) return;
    const requestId = ++latestLocationRequest.current;
    setLocating(true);
    setLocationNotice(null);
    invalidateResult();
    try {
      const place = await resolveCurrentPlace();
      if (requestId !== latestLocationRequest.current) return;
      setCurrentPlace(place);
      setStartId(place.id);
      setLocationNotice({
        tone: "success",
        message: "현재 위치를 출발지로 설정했어요.",
      });
    } catch (error) {
      if (requestId !== latestLocationRequest.current) return;
      const wasUsingCurrentLocation = startId === currentPlace?.id;
      setCurrentPlace(null);
      if (wasUsingCurrentLocation) {
        setStartId(PLACES[0].id);
      }
      setLocationNotice({
        tone: "error",
        message: locationErrorMessage(error),
        action:
          error instanceof CurrentLocationError &&
          error.code === "LOCATION_PERMISSION_DENIED"
            ? "request-permission"
            : undefined,
      });
    } finally {
      if (requestId === latestLocationRequest.current) setLocating(false);
    }
  };

  const retryLocationPermission = async () => {
    if (busy) return;
    setLocating(true);
    setLocationNotice(null);
    const allowed = await requestCurrentLocationPermission();
    setLocating(false);
    if (allowed) {
      await handleCurrentLocation();
      return;
    }
    setLocationNotice({
      tone: "error",
      message: "아이폰 설정에서 위치 권한을 허용한 뒤 다시 시도해 주세요.",
      action: "request-permission",
    });
  };

  const selectedRoute = bundle
    ? routeByMode(bundle.routes, selectedMode)
    : null;
  const shortestRoute = bundle ? routeByMode(bundle.routes, "shortest") : null;
  const samePlace = startId === goalId;
  const recommendedMode: RouteMode =
    weather && offsetMinutes === 0 ? weatherGuidance(weather).mode : "balanced";
  const isResultView =
    bundle !== null &&
    selectedRoute !== null &&
    shortestRoute !== null &&
    status !== "error";

  useEffect(() => {
    if (status === "success" && bundle !== null) {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
  }, [bundle, status]);

  return (
    <main className={isResultView ? "app-shell result-view" : "app-shell"}>
      {!isResultView && (
        <>
          <header className="hero">
            <span className="hero-kicker">서울 전역 · 3km 이내</span>
            <Top
              title={<span className="app-title">오늘, 햇빛을 덜 받는 길</span>}
              subtitleBottom={
                <Top.SubtitleParagraph size={17}>
                  출발 시각의 건물 그림자를 계산해 세 경로를 비교해요.
                </Top.SubtitleParagraph>
              }
            />
          </header>

          <WeatherBanner
            status={weatherStatus}
            weather={weather}
            offsetMinutes={offsetMinutes}
            onRetry={() => setWeatherAttempt((attempt) => attempt + 1)}
          />

          <section className="search-panel" aria-labelledby="search-title">
            <div className="section-heading compact">
              <div>
                <span className="section-index">01</span>
                <h2 id="search-title">어디로 걸어갈까요?</h2>
              </div>
              <span className="area-badge">서울 장소·주소 검색</span>
            </div>

            {placeLoadState === "error" && (
              <div className="station-load-notice" role="alert">
                <span>서울 장소 목록을 불러오지 못했어요.</span>
                <button
                  type="button"
                  onClick={() => setPlaceLoadAttempt((attempt) => attempt + 1)}
                >
                  장소 목록 다시 불러오기
                </button>
              </div>
            )}

            <div className="place-fields">
              {selectedStart && (
                <PlaceCombobox
                  id="start"
                  label="출발지"
                  selected={selectedStart}
                  places={startOptions}
                  onSelect={selectStartPlace}
                  onEditingChange={(editing) => {
                    setStartEditing(editing);
                    if (editing) invalidateResult();
                  }}
                  disabled={busy}
                  invalid={samePlace || startEditing}
                  describedBy={
                    startEditing
                      ? "place-selection-error"
                      : samePlace
                        ? "same-place-error"
                        : undefined
                  }
                />
              )}
              <button
                className="swap-button"
                type="button"
                onClick={swapPlaces}
                disabled={busy || startId === currentPlace?.id}
                aria-label="출발지와 도착지 바꾸기"
              >
                ⇅
              </button>
              {selectedGoal && (
                <PlaceCombobox
                  id="goal"
                  label="도착지"
                  selected={selectedGoal}
                  places={places}
                  onSelect={selectGoalPlace}
                  onEditingChange={(editing) => {
                    setGoalEditing(editing);
                    if (editing) invalidateResult();
                  }}
                  disabled={busy}
                  invalid={samePlace || goalEditing}
                  describedBy={
                    goalEditing
                      ? "place-selection-error"
                      : samePlace
                        ? "same-place-error"
                        : undefined
                  }
                />
              )}
            </div>

            {hasUncommittedSearch && (
              <p
                id="place-selection-error"
                className="inline-error"
                role="status"
              >
                검색 결과에서 장소를 선택해 주세요.
              </p>
            )}

            <button
              className="current-location-button"
              type="button"
              disabled={busy}
              onClick={() => void handleCurrentLocation()}
            >
              <span aria-hidden="true">◎</span>
              {locating ? "위치를 확인하고 있어요" : "현재 위치로 출발"}
            </button>
            <p className="location-privacy">
              위치는 경로·지도 표시에만 사용하며 앱에 저장하지 않아요. 지도 표시
              시 주변 영역이 OpenStreetMap에 전달돼요. 날씨는 서울 대표 좌표로
              조회하며 사용자의 현재 위치를 보내지 않아요.
            </p>
            {locationNotice && (
              <div
                className={`location-notice ${locationNotice.tone}`}
                role={locationNotice.tone === "success" ? "status" : "alert"}
                aria-live={
                  locationNotice.tone === "success" ? "polite" : "assertive"
                }
              >
                <span>{locationNotice.message}</span>
                {locationNotice.action === "request-permission" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void retryLocationPermission()}
                  >
                    위치 권한 다시 요청
                  </button>
                )}
              </div>
            )}

            <div className="time-block">
              <span className="input-label">출발 시각</span>
              <div className="time-chips">
                {TIME_OPTIONS.map((option) => (
                  <button
                    key={option.minutes}
                    type="button"
                    className={
                      offsetMinutes === option.minutes
                        ? "time-chip active"
                        : "time-chip"
                    }
                    aria-pressed={offsetMinutes === option.minutes}
                    disabled={busy}
                    onClick={() => selectTime(option.minutes)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              className="primary-cta"
              type="button"
              disabled={busy || samePlace || hasUncommittedSearch}
              onClick={() => void runSearch()}
            >
              {status === "loading"
                ? "그늘을 계산하고 있어요"
                : "그늘 경로 찾기"}
            </button>
            {samePlace && (
              <p
                id="same-place-error"
                className="inline-error"
                role="alert"
                aria-live="assertive"
              >
                출발지와 도착지를 다르게 선택해 주세요.
              </p>
            )}
          </section>
        </>
      )}

      {isResultView && (
        <header className="c-topbar">
          <button
            className="c-topbar-back"
            type="button"
            onClick={invalidateResult}
            aria-label="검색으로 돌아가기"
          >
            ←
          </button>
          <h1
            className="c-topbar-route"
            aria-label={`${bundle.start.name}에서 ${bundle.goal.name}까지`}
          >
            <span>{bundle.start.name}</span>
            <em aria-hidden="true">→</em>
            <span>{bundle.goal.name}</span>
          </h1>
        </header>
      )}

      {status === "loading" && (
        <section className="loading-card" aria-live="polite">
          <span className="loading-sun" aria-hidden="true">
            ☀
          </span>
          <div>
            <strong>건물 그림자를 움직이는 중</strong>
            <p>주변 보행로와 건물을 비교하고 있어요.</p>
          </div>
        </section>
      )}

      {status === "error" && !samePlace && (
        <section className="error-card" aria-live="assertive">
          <div>
            <strong>
              {routeError === "near-goal"
                ? "이미 도착지 근처예요"
                : routeError === "too-long"
                  ? "3km 이내 경로만 지원해요"
                  : routeError === "outside-seoul"
                    ? "서울 안의 장소를 선택해 주세요"
                    : routeError === "off-network"
                      ? "가까운 지원 보행로를 찾지 못했어요"
                      : routeError === "complex-data"
                        ? "이 지역의 경로 데이터가 너무 복잡해요"
                        : "경로를 불러오지 못했어요"}
            </strong>
            <p>
              {routeError === "near-goal"
                ? "다른 도착지를 선택해 주세요."
                : routeError === "too-long"
                  ? "출발지에서 더 가까운 장소를 선택해 주세요."
                  : routeError === "outside-seoul"
                    ? "현재는 서울 지역만 이용할 수 있어요."
                    : routeError === "off-network"
                      ? "가까운 장소를 선택하거나 현재 위치를 다시 확인해 주세요."
                      : routeError === "complex-data"
                        ? "더 가까운 장소를 선택해 다시 시도해 주세요."
                        : "데이터 연결을 확인하고 다시 시도해 주세요."}
            </p>
          </div>
          {routeError === "generic" && (
            <button type="button" onClick={() => void runSearch()}>
              다시 시도
            </button>
          )}
        </section>
      )}

      {bundle && selectedRoute && shortestRoute && status !== "error" && (
        <>
          <div className="c-map-full">
            <RouteMap
              route={selectedRoute}
              start={bundle.start}
              goal={bundle.goal}
              getBottomOcclusionElement={getResultSheet}
            />
          </div>

          <aside
            ref={resultSheet}
            aria-label="경로 정보"
            {...resultSheetMotion.sheetProps}
          >
            <ResultSheetHandle
              controls="route-sheet-directions"
              {...resultSheetMotion.handleProps}
            />

            <table
              className="c-sheet-table"
              aria-label="경로 선택 및 세 경로 지표 비교"
            >
              <thead>
                <tr>
                  <th scope="col" aria-label="지표" />
                  {bundle.routes.map((route) => {
                    const selected = route.mode === selectedRoute.mode;
                    return (
                      <th key={route.mode} scope="col">
                        <button
                          type="button"
                          className={
                            selected
                              ? "c-sheet-col-header selected"
                              : "c-sheet-col-header"
                          }
                          aria-label={`${route.label} 경로 선택`}
                          aria-pressed={selected}
                          disabled={busy}
                          onClick={() => setSelectedMode(route.mode)}
                        >
                          <span>{route.label}</span>
                          {route.mode === recommendedMode && <em>추천</em>}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody id="route-sheet-metrics">
                <tr>
                  <th scope="row">시간</th>
                  {bundle.routes.map((route) => (
                    <td
                      key={route.mode}
                      className={
                        route.mode === selectedRoute.mode ? "selected" : ""
                      }
                    >
                      <b>{walkMinutes(route.timeSec)}</b>분
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">거리</th>
                  {bundle.routes.map((route) => (
                    <td
                      key={route.mode}
                      className={
                        route.mode === selectedRoute.mode ? "selected" : ""
                      }
                    >
                      {distanceLabel(route.lengthM)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">햇빛</th>
                  {bundle.routes.map((route) => (
                    <td
                      key={route.mode}
                      className={
                        route.mode === selectedRoute.mode ? "selected" : ""
                      }
                    >
                      {sunMinutes(route.sunSec)}분
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">예상 그늘</th>
                  {bundle.routes.map((route) => (
                    <td
                      key={route.mode}
                      className={
                        route.mode === selectedRoute.mode
                          ? "selected shade-cell"
                          : "shade-cell"
                      }
                    >
                      <span className="shade-bar" aria-hidden="true">
                        <i
                          style={{
                            width: `${Math.round(route.shadeRatio * 100)}%`,
                          }}
                        />
                      </span>
                      <b>{Math.round(route.shadeRatio * 100)}%</b>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>

            <div
              id="route-sheet-time"
              className="c-sheet-time"
              role="group"
              aria-label="출발 시각"
              data-sheet-peek-end
            >
              {TIME_OPTIONS.map((option) => (
                <button
                  key={option.minutes}
                  type="button"
                  className={
                    offsetMinutes === option.minutes
                      ? "time-chip active"
                      : "time-chip"
                  }
                  aria-pressed={offsetMinutes === option.minutes}
                  disabled={busy}
                  onClick={() => selectTime(option.minutes)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div id="route-sheet-directions" className="c-sheet-directions">
              <RouteDirections
                route={selectedRoute}
                requestedAt={bundle.requestedAt}
                goal={bundle.goal}
              />
              <p className="estimate-note">
                예상 그늘 · 실제 현장과 다를 수 있어요
              </p>
              {feedbackWebhookUrl && (
                <RouteFeedback
                  route={selectedRoute}
                  requestedAt={bundle.requestedAt}
                  webhookUrl={feedbackWebhookUrl}
                />
              )}
            </div>
          </aside>
        </>
      )}
    </main>
  );
}

export default App;
