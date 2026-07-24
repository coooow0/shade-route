import type { RoutePlacesRequest } from "./types";

export interface RouteWorkerRequestMessage {
  readonly schema: 1;
  readonly request: RoutePlacesRequest;
}

export const ROUTE_WORKER_ERROR_CODES = new Set([
  "SAME_PLACE",
  "EMPTY_GRAPH",
  "SNAP_FAILED",
  "ALREADY_NEAR_GOAL",
  "ROUTE_NOT_FOUND",
  "ROUTE_TOO_LONG",
  "OUTSIDE_SEOUL",
  "ROUTE_DATA_TOO_COMPLEX",
  "AREA_DATA_UNAVAILABLE",
  "ROUTE_TOO_LARGE",
  "TILE_LOAD_FAILED",
  "INVALID_TILE_MANIFEST",
  "INVALID_TILE_DATA",
  "ROUTE_ARTIFACT_MISMATCH",
]);

function isFiniteCoordinate(value: unknown, minimum: number, maximum: number) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isWorkerPlace(value: unknown) {
  if (typeof value !== "object" || value === null) return false;
  const place = value as Record<string, unknown>;
  return (
    typeof place.id === "string" &&
    place.id.length > 0 &&
    place.id.length <= 160 &&
    typeof place.name === "string" &&
    place.name.length > 0 &&
    place.name.length <= 160 &&
    isFiniteCoordinate(place.lat, -90, 90) &&
    isFiniteCoordinate(place.lon, -180, 180)
  );
}

export function isRouteWorkerRequest(
  value: unknown,
): value is RouteWorkerRequestMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  if (
    message.schema !== 1 ||
    typeof message.request !== "object" ||
    message.request === null
  )
    return false;
  const request = message.request as Record<string, unknown>;
  return (
    isWorkerPlace(request.start) &&
    isWorkerPlace(request.goal) &&
    (request.offsetMinutes === 0 ||
      request.offsetMinutes === 30 ||
      request.offsetMinutes === 60)
  );
}

export function safeRouteWorkerError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return ROUTE_WORKER_ERROR_CODES.has(code) ? code : "ROUTE_CALCULATION_FAILED";
}
