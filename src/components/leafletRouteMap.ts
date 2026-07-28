import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { LiveLocationSample } from "../domain/location/liveLocation";
import type { Place, RouteResult, RouteSegment } from "../domain/routing/types";

const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const MAX_ACCURACY_RADIUS_M = 1_000;

export interface MountLeafletRouteMapOptions {
  readonly element: HTMLDivElement;
  readonly route: RouteResult;
  readonly start: Place;
  readonly goal: Place;
  readonly onTileError: () => void;
}

export interface LeafletRouteMapController {
  readonly updateCurrentLocation: (
    location: LiveLocationSample | null,
    following: boolean,
  ) => void;
  readonly destroy: () => void;
}

function segmentStyle(segment: RouteSegment): L.PathOptions {
  if (segment.connector) {
    return {
      color: "#8b95a1",
      dashArray: "7 7",
      className: "route-segment connector",
    };
  }

  const shaded = segment.covered || segment.shadeRatio >= 0.5;
  return {
    color: shaded ? "#3156d3" : "#ff9f43",
    className: shaded ? "route-segment shaded" : "route-segment sunny",
  };
}

function routeLine(segment: RouteSegment): L.LatLngTuple[] {
  return [
    [segment.from.lat, segment.from.lon],
    [segment.to.lat, segment.to.lon],
  ];
}

function addMarker(
  map: L.Map,
  place: Place,
  label: "출발" | "도착",
  color: string,
) {
  L.circleMarker([place.lat, place.lon], {
    radius: 8,
    color: "#ffffff",
    weight: 4,
    fillColor: color,
    fillOpacity: 1,
  })
    .addTo(map)
    .bindTooltip(label, {
      permanent: true,
      direction: "top",
      offset: [0, -9],
      className: "route-marker-label",
    });
}

export function mountLeafletRouteMap({
  element,
  route,
  start,
  goal,
  onTileError,
}: MountLeafletRouteMapOptions): LeafletRouteMapController {
  // JSDOM has no layout engine. Component tests inject a map mount when needed.
  if (navigator.userAgent.toLowerCase().includes("jsdom")) {
    return {
      updateCurrentLocation: () => undefined,
      destroy: () => undefined,
    };
  }

  const map = L.map(element, {
    attributionControl: false,
    scrollWheelZoom: false,
    zoomControl: false,
  });
  L.control.zoom({ position: "topright" }).addTo(map);

  L.tileLayer(OSM_TILE_URL, {
    maxZoom: 19,
    crossOrigin: true,
  })
    .on("tileerror", onTileError)
    .addTo(map);

  const bounds = L.latLngBounds([
    [start.lat, start.lon],
    [goal.lat, goal.lon],
  ]);

  route.segments.forEach((segment) => {
    bounds.extend([segment.from.lat, segment.from.lon]);
    bounds.extend([segment.to.lat, segment.to.lon]);
  });

  L.polyline(route.segments.map(routeLine), {
    color: "#ffffff",
    weight: 11,
    opacity: 0.92,
    lineCap: "round",
    lineJoin: "round",
    className: "route-casing",
  }).addTo(map);

  const groups = [
    route.segments.filter((segment) => Boolean(segment.connector)),
    route.segments.filter(
      (segment) =>
        !segment.connector && (segment.covered || segment.shadeRatio >= 0.5),
    ),
    route.segments.filter(
      (segment) =>
        !segment.connector && !segment.covered && segment.shadeRatio < 0.5,
    ),
  ];
  for (const segments of groups) {
    const representative = segments[0];
    if (!representative) continue;
    L.polyline(segments.map(routeLine), {
      ...segmentStyle(representative),
      weight: 7,
      opacity: 0.96,
      lineCap: "round",
      lineJoin: "round",
    }).addTo(map);
  }

  addMarker(map, start, "출발", "#3182f6");
  addMarker(map, goal, "도착", "#ff7a45");

  const fitToBounds = () =>
    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 17 });
  fitToBounds();

  // 검색 → 결과 화면 전환 직후 컨테이너 레이아웃이 아직 확정되지 않은 상태에서
  // Leaflet이 크기를 잘못 재면 경로가 안 그려지고 사용자가 지도를 한 번 움직여야
  // 보였다. 한 프레임 미룬 뒤 다시 재고 fit을 다시 한다. 이후 방향 전환 등으로
  // 컨테이너 크기가 바뀌어도 자동으로 재보정하도록 ResizeObserver도 붙인다.
  let destroyed = false;
  const initialFitFrame = globalThis.requestAnimationFrame?.(() => {
    if (destroyed) return;
    map.invalidateSize();
    fitToBounds();
  });

  let resizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver !== "undefined") {
    let firstEntry = true;
    resizeObserver = new ResizeObserver(() => {
      if (destroyed) return;
      // ResizeObserver의 최초 콜백은 초기 크기 보고라 굳이 재보정할 필요가 없다.
      if (firstEntry) {
        firstEntry = false;
        return;
      }
      map.invalidateSize();
    });
    resizeObserver.observe(element);
  }

  let accuracyCircle: L.Circle | null = null;
  let currentLocationMarker: L.CircleMarker | null = null;

  const removeCurrentLocation = () => {
    if (accuracyCircle) map.removeLayer(accuracyCircle);
    if (currentLocationMarker) map.removeLayer(currentLocationMarker);
    accuracyCircle = null;
    currentLocationMarker = null;
  };

  return {
    updateCurrentLocation: (location, following) => {
      if (destroyed) return;
      if (location === null) {
        removeCurrentLocation();
        return;
      }

      const latLng = L.latLng(location.lat, location.lon);
      const accuracyRadiusM = Math.min(
        location.accuracyM,
        MAX_ACCURACY_RADIUS_M,
      );
      if (accuracyCircle === null) {
        accuracyCircle = L.circle(latLng, {
          radius: accuracyRadiusM,
          color: "#3182f6",
          weight: 1,
          opacity: 0.35,
          fillColor: "#3182f6",
          fillOpacity: 0.12,
          className: "current-location-accuracy",
          interactive: false,
        }).addTo(map);
      } else {
        accuracyCircle.setLatLng(latLng);
        accuracyCircle.setRadius(accuracyRadiusM);
      }

      if (currentLocationMarker === null) {
        currentLocationMarker = L.circleMarker(latLng, {
          radius: 8,
          color: "#ffffff",
          weight: 3,
          fillColor: "#3182f6",
          fillOpacity: 1,
          className: "current-location-marker",
        })
          .addTo(map)
          .bindTooltip("내 위치", {
            direction: "top",
            offset: [0, -9],
            className: "route-marker-label current",
          });
      } else {
        currentLocationMarker.setLatLng(latLng);
      }

      if (following) {
        map.panTo(latLng, { animate: true, duration: 0.35 });
      }
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      if (initialFitFrame !== undefined) {
        globalThis.cancelAnimationFrame?.(initialFitFrame);
      }
      resizeObserver?.disconnect();
      map.remove();
    },
  };
}
