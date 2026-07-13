import { Top } from "@toss/tds-mobile";
import { useEffect, useRef, useState } from "react";
import PlaceCombobox from "./components/PlaceCombobox";
import RouteDirections from "./components/RouteDirections";
import RouteMap from "./components/RouteMap";
import WeatherBanner from "./components/WeatherBanner";
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
import {
  calculateRouteBundleForPlaces,
  PLACES,
} from "./domain/routing/routeService";
import type {
  Place,
  RouteBundle,
  RouteMode,
  RouteResult,
} from "./domain/routing/types";
import "./App.css";

const TIME_OPTIONS = [
  { label: "지금", minutes: 0 },
  { label: "30분 뒤", minutes: 30 },
  { label: "1시간 뒤", minutes: 60 },
] as const;

const SEOUL_WEATHER_LOCATION = { lat: 37.5665, lon: 126.978 } as const;

function walkMinutes(seconds: number) {
  return Math.max(1, Math.round(seconds / 60));
}

function sunMinutes(seconds: number) {
  return Math.max(0, Math.round(seconds / 60));
}

function distanceLabel(meters: number) {
  return meters >= 1_000 ? `${(meters / 1_000).toFixed(1)}km` : `${meters}m`;
}

function routeDescription(route: RouteResult, shortest: RouteResult) {
  if (route.mode === "shortest") return "가장 빠르게 도착해요";
  const extra = Math.max(
    0,
    walkMinutes(route.timeSec) - walkMinutes(shortest.timeSec),
  );
  const saved = Math.max(
    0,
    sunMinutes(shortest.sunSec) - sunMinutes(route.sunSec),
  );
  if (saved === 0)
    return extra === 0 ? "빠른길과 비슷해요" : `${extra}분 더 걸려요`;
  return `${extra}분 더 걷고 햇빛 ${saved}분 절약`;
}

function routeByMode(routes: readonly RouteResult[], mode: RouteMode) {
  return routes.find((route) => route.mode === mode) ?? routes[0];
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
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [routeError, setRouteError] = useState<
    "generic" | "near-goal" | "off-network" | "too-long" | "outside-seoul"
  >("generic");
  const latestRequest = useRef(0);
  const latestLocationRequest = useRef(0);

  const busy = status === "loading" || locating;
  const hasUncommittedSearch = startEditing || goalEditing;
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

  const invalidateResult = () => {
    latestRequest.current += 1;
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
    const requestId = ++latestRequest.current;
    setStatus("loading");
    setRouteError("generic");
    try {
      const result = await calculateRouteBundleForPlaces({
        start: selectedStart,
        goal: selectedGoal,
        offsetMinutes: offset,
      });
      if (requestId !== latestRequest.current) return;
      setBundle(result);
      setSelectedMode((current) =>
        result.routes.some((route) => route.mode === current)
          ? current
          : routeByMode(result.routes, "balanced").mode,
      );
      setStatus("success");
    } catch (error) {
      if (requestId !== latestRequest.current) return;
      setBundle(null);
      const errorMessage = error instanceof Error ? error.message : "";
      setRouteError(
        errorMessage === "ALREADY_NEAR_GOAL"
          ? "near-goal"
          : errorMessage === "ROUTE_TOO_LONG"
            ? "too-long"
            : errorMessage === "OUTSIDE_SEOUL"
              ? "outside-seoul"
              : errorMessage === "SNAP_FAILED" ||
                  errorMessage === "ROUTE_NOT_FOUND"
                ? "off-network"
                : "generic",
      );
      setStatus("error");
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
        <header className="result-header">
          <div className="result-title-row">
            <div>
              <span className="result-kicker">서울 그늘 경로</span>
              <h1>
                {bundle.start.name}에서 {bundle.goal.name}까지
              </h1>
            </div>
            <button type="button" onClick={invalidateResult}>
              출발지·도착지 수정
            </button>
          </div>
          <p className="result-benefit">
            {routeDescription(selectedRoute, shortestRoute)} · 예상 그늘{" "}
            {Math.round(selectedRoute.shadeRatio * 100)}%
          </p>
          <div className="result-time-row">
            <span>출발 시각</span>
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
          <section
            className="comparison-section result-comparison"
            aria-labelledby="comparison-title"
          >
            <div className="section-heading">
              <div>
                <span className="section-index">02</span>
                <h2 id="comparison-title">경로 비교</h2>
              </div>
              <span className="calculated-time">예상 그늘 기준</span>
            </div>
            <div className="route-cards">
              {bundle.routes.map((route) => {
                const selected = route.mode === selectedRoute.mode;
                return (
                  <button
                    key={route.mode}
                    type="button"
                    className={
                      selected
                        ? `route-card ${route.mode} selected`
                        : `route-card ${route.mode}`
                    }
                    aria-label={`${route.label} 경로 선택`}
                    aria-pressed={selected}
                    disabled={busy}
                    onClick={() => setSelectedMode(route.mode)}
                  >
                    <span className="route-card-top">
                      <strong>{route.label}</strong>
                      {route.mode === recommendedMode && <em>추천</em>}
                    </span>
                    <span className="route-time">
                      {walkMinutes(route.timeSec)}분
                    </span>
                    <span className="route-meta">
                      {distanceLabel(route.lengthM)} · 햇빛{" "}
                      {sunMinutes(route.sunSec)}분
                    </span>
                    <span className="shade-meter">
                      <i
                        style={{
                          width: `${Math.round(route.shadeRatio * 100)}%`,
                        }}
                      />
                    </span>
                    <span className="shade-percent">
                      예상 그늘 {Math.round(route.shadeRatio * 100)}%
                    </span>
                    <span className="route-description">
                      {routeDescription(route, shortestRoute)}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section
            className="map-section result-map-section"
            aria-labelledby="map-title"
          >
            <div className="section-heading">
              <div>
                <span className="section-index">03</span>
                <h2 id="map-title">{selectedRoute.label} 경로</h2>
              </div>
              <span className="selected-summary">
                햇빛 {sunMinutes(selectedRoute.sunSec)}분
              </span>
            </div>
            <RouteDirections
              route={selectedRoute}
              requestedAt={bundle.requestedAt}
              goal={bundle.goal}
            >
              <RouteMap
                route={selectedRoute}
                start={bundle.start}
                goal={bundle.goal}
              />
            </RouteDirections>
            <p className="estimate-note">
              건물 높이와 태양 위치로 계산한 예상 그늘이에요. 실제 현장과 다를
              수 있어요.
            </p>
          </section>
        </>
      )}
    </main>
  );
}

export default App;
