import { useCallback, useEffect, useRef, useState } from "react";
import { CurrentLocationError } from "../domain/location/currentLocation";
import {
  subscribeLiveLocation,
  type LiveLocationSample,
} from "../domain/location/liveLocation";
import {
  INITIAL_ROUTE_ADHERENCE,
  updateRouteAdherence,
  type RouteAdherenceState,
} from "../domain/location/routeAdherence";
import type { Place, RouteResult } from "../domain/routing/types";
import {
  mountLeafletRouteMap,
  type LeafletRouteMapController,
  type MountLeafletRouteMapOptions,
} from "./leafletRouteMap";

export type RouteMapMount = (
  options: MountLeafletRouteMapOptions,
) => LeafletRouteMapController;

export type LiveLocationSubscribe = typeof subscribeLiveLocation;

interface RouteMapProps {
  readonly route: RouteResult;
  readonly start: Place;
  readonly goal: Place;
  readonly getBottomOcclusionElement?: () => HTMLElement | null;
  readonly mountMap?: RouteMapMount;
  readonly subscribeLocation?: LiveLocationSubscribe;
}

function liveLocationErrorMessage(error: CurrentLocationError) {
  if (error.code === "LOCATION_PERMISSION_DENIED") {
    return "위치 권한을 허용하면 지도에서 내 위치를 볼 수 있어요.";
  }
  if (error.code === "OUTSIDE_SEOUL") {
    return "현재 위치가 서울 밖이에요. 경로 지도는 계속 볼 수 있어요.";
  }
  return "내 위치를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.";
}

function adherenceMessage(adherence: RouteAdherenceState) {
  if (adherence.kind === "off-route") return "경로를 벗어난 것 같아요";
  if (adherence.kind === "on-route") return "선택한 경로 근처를 걷고 있어요";
  return "경로와의 거리를 확인하고 있어요";
}

export default function RouteMap({
  route,
  start,
  goal,
  getBottomOcclusionElement,
  mountMap = mountLeafletRouteMap,
  subscribeLocation = subscribeLiveLocation,
}: RouteMapProps) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapController = useRef<LeafletRouteMapController | null>(null);
  const stopLocationUpdates = useRef<(() => void) | null>(null);
  const currentLocationRef = useRef<LiveLocationSample | null>(null);
  const routeSegmentsRef = useRef(route.segments);
  const followingRef = useRef(false);
  const [tileFailed, setTileFailed] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [currentLocation, setCurrentLocation] =
    useState<LiveLocationSample | null>(null);
  const [following, setFollowing] = useState(false);
  const [locationError, setLocationError] =
    useState<CurrentLocationError | null>(null);
  const [adherence, setAdherence] = useState<RouteAdherenceState>(
    INITIAL_ROUTE_ADHERENCE,
  );
  const hasGeometry = route.segments.length > 0;

  const stopTracking = useCallback(() => {
    stopLocationUpdates.current?.();
    stopLocationUpdates.current = null;
    setTracking(false);
    setFollowing(false);
    setCurrentLocation(null);
    setLocationError(null);
    setAdherence(INITIAL_ROUTE_ADHERENCE);
  }, []);

  currentLocationRef.current = currentLocation;
  routeSegmentsRef.current = route.segments;
  followingRef.current = following;

  useEffect(() => {
    const element = mapElement.current;
    if (!element || !hasGeometry) return undefined;

    setTileFailed(false);
    setMapFailed(false);
    try {
      const controller = mountMap({
        element,
        route,
        start,
        goal,
        onTileError: () => setTileFailed(true),
        getBottomOcclusionElement,
      });
      mapController.current = controller;
      controller.updateCurrentLocation(
        currentLocationRef.current,
        followingRef.current,
      );
      return () => {
        if (mapController.current === controller) mapController.current = null;
        controller.destroy();
      };
    } catch {
      mapController.current = null;
      setMapFailed(true);
      return undefined;
    }
  }, [getBottomOcclusionElement, goal, hasGeometry, mountMap, route, start]);

  useEffect(() => {
    mapController.current?.updateCurrentLocation(currentLocation, following);
  }, [currentLocation, following]);

  useEffect(() => {
    setAdherence(INITIAL_ROUTE_ADHERENCE);
  }, [route.pathKey]);

  useEffect(
    () => () => {
      stopLocationUpdates.current?.();
      stopLocationUpdates.current = null;
    },
    [],
  );

  useEffect(() => {
    const stopForBackground = () => stopTracking();
    const stopWhenHidden = () => {
      if (document.visibilityState === "hidden") stopTracking();
    };

    window.addEventListener("pagehide", stopForBackground);
    document.addEventListener("visibilitychange", stopWhenHidden);
    return () => {
      window.removeEventListener("pagehide", stopForBackground);
      document.removeEventListener("visibilitychange", stopWhenHidden);
    };
  }, [stopTracking]);

  const startTracking = () => {
    stopLocationUpdates.current?.();
    setTracking(true);
    setFollowing(true);
    setLocationError(null);
    setAdherence(INITIAL_ROUTE_ADHERENCE);
    stopLocationUpdates.current = subscribeLocation({
      onLocation: (sample) => {
        setCurrentLocation(sample);
        setLocationError(null);
        setAdherence((previous) =>
          updateRouteAdherence(previous, sample, routeSegmentsRef.current),
        );
      },
      onError: (error) => setLocationError(error),
    });
  };

  const showRoute = () => {
    setFollowing(false);
    mapController.current?.showRoute();
  };

  if (!hasGeometry) {
    return <div className="map-empty">표시할 경로가 없어요.</div>;
  }

  return (
    <div className="route-map-wrap">
      <div className="route-map-stage">
        <div
          ref={mapElement}
          className="route-map"
          role="region"
          aria-label={`${route.label} 경로 지도`}
          data-basemap="openstreetmap"
        />
        <div className="map-location-controls">
          {!tracking ? (
            <button type="button" disabled={mapFailed} onClick={startTracking}>
              <span aria-hidden="true">◉</span>
              지도에 내 위치 표시
            </button>
          ) : currentLocation === null ? (
            <>
              <button
                type="button"
                disabled={!locationError}
                onClick={startTracking}
              >
                {locationError ? "내 위치 다시 확인" : "내 위치 확인 중"}
              </button>
              <button type="button" onClick={stopTracking}>
                취소
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                aria-pressed={following}
                onClick={() => setFollowing((current) => !current)}
              >
                <span aria-hidden="true">◉</span>
                {following ? "지도 자동 이동 켜짐" : "지도 자동 이동 켜기"}
              </button>
              <button type="button" onClick={showRoute}>
                경로 다시 보기
              </button>
              <button type="button" onClick={stopTracking}>
                위치 숨기기
              </button>
            </>
          )}
        </div>
      </div>

      {currentLocation && (
        <div className={`map-location-status ${adherence.kind}`}>
          <strong
            role={adherence.kind === "off-route" ? "alert" : "status"}
            aria-live={
              adherence.kind === "off-route" ? "assertive" : "polite"
            }
          >
            {adherenceMessage(adherence)}
          </strong>
          <span aria-live="off">
            내 위치 오차 약 {Math.round(currentLocation.accuracyM)}m
          </span>
        </div>
      )}
      {locationError && (
        <p className="map-location-error" role="alert">
          {liveLocationErrorMessage(locationError)}
        </p>
      )}
      {tileFailed && (
        <p className="map-tile-notice" role="status">
          지도 배경을 불러오지 못했어요. 경로는 계속 확인할 수 있어요.
        </p>
      )}
      {mapFailed && (
        <p className="map-tile-notice" role="status">
          지도를 시작하지 못했어요. 경로 요약은 계속 확인할 수 있어요.
        </p>
      )}
      <p className="map-location-privacy">
        위치는 저장하지 않아요. 지도에 표시되는 주변 영역은 OpenStreetMap
        타일 서버에 전달될 수 있어요.
      </p>
      <div className="map-footer">
        <div className="map-legend" aria-label="경로 범례">
          <span>
            <i className="legend-line shade" />
            예상 그늘
          </span>
          <span>
            <i className="legend-line sun" />
            햇빛
          </span>
          <span>
            <i className="legend-line connector" />
            접근 구간
          </span>
        </div>
        <a
          className="map-attribution"
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="OpenStreetMap 기여자"
        >
          © OpenStreetMap contributors
        </a>
      </div>
    </div>
  );
}
