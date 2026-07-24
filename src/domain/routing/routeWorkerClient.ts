import { ROUTE_RESOURCE_LIMITS } from "./resourceLimits";
import { ROUTE_WORKER_ERROR_CODES } from "./routeWorkerProtocol";
import type {
  LatLng,
  Place,
  RouteBundle,
  RoutePlacesRequest,
  RouteResult,
  RouteSegment,
} from "./types";

const DEFAULT_ROUTE_TIMEOUT_MS = 30_000;
const MAX_PATH_KEY_LENGTH = 50_000;

export interface RouteWorkerLike {
  postMessage(message: unknown): void;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  terminate(): void;
}

export interface RouteCalculationOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly workerFactory?: () => RouteWorkerLike;
}

function createRouteWorker(): RouteWorkerLike {
  return new Worker(new URL("./route.worker.ts", import.meta.url), {
    type: "module",
    name: "shade-route-calculation",
  }) as RouteWorkerLike;
}

function isFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

function isLatLng(value: unknown): value is LatLng {
  if (typeof value !== "object" || value === null) return false;
  const point = value as Partial<LatLng>;
  return (
    isFiniteNumber(point.lat) &&
    isFiniteNumber(point.lon) &&
    (point.lat ?? 0) >= -90 &&
    (point.lat ?? 0) <= 90 &&
    (point.lon ?? 0) >= -180 &&
    (point.lon ?? 0) <= 180
  );
}

function isPlace(value: unknown): value is Place {
  if (typeof value !== "object" || value === null) return false;
  const place = value as Partial<Place>;
  return (
    typeof place.id === "string" &&
    place.id.length > 0 &&
    place.id.length <= 160 &&
    typeof place.name === "string" &&
    place.name.length > 0 &&
    place.name.length <= 160 &&
    isLatLng(place)
  );
}

function isRouteSegment(value: unknown): value is RouteSegment {
  if (typeof value !== "object" || value === null) return false;
  const segment = value as Partial<RouteSegment>;
  return (
    isLatLng(segment.from) &&
    isLatLng(segment.to) &&
    isFiniteNumber(segment.shadeRatio) &&
    (segment.shadeRatio ?? -1) >= 0 &&
    (segment.shadeRatio ?? 2) <= 1 &&
    typeof segment.covered === "boolean" &&
    (segment.steps === undefined || typeof segment.steps === "boolean") &&
    (segment.connector === undefined || typeof segment.connector === "boolean")
  );
}

function isRouteResult(value: unknown): value is RouteResult {
  if (typeof value !== "object" || value === null) return false;
  const route = value as Partial<RouteResult>;
  return (
    (route.mode === "shortest" ||
      route.mode === "balanced" ||
      route.mode === "maxShade") &&
    typeof route.label === "string" &&
    route.label.length <= 30 &&
    typeof route.pathKey === "string" &&
    route.pathKey.length <= MAX_PATH_KEY_LENGTH &&
    isFiniteNumber(route.timeSec) &&
    (route.timeSec ?? -1) >= 0 &&
    isFiniteNumber(route.lengthM) &&
    (route.lengthM ?? -1) >= 0 &&
    isFiniteNumber(route.sunSec) &&
    (route.sunSec ?? -1) >= 0 &&
    isFiniteNumber(route.shadeRatio) &&
    (route.shadeRatio ?? -1) >= 0 &&
    (route.shadeRatio ?? 2) <= 1 &&
    Array.isArray(route.segments) &&
    route.segments.length <= ROUTE_RESOURCE_LIMITS.routeSegments + 2 &&
    route.segments.every(isRouteSegment)
  );
}

function isRouteBundle(value: unknown): value is RouteBundle {
  if (typeof value !== "object" || value === null) return false;
  const bundle = value as Partial<RouteBundle>;
  if (
    typeof bundle.requestedAt !== "string" ||
    bundle.requestedAt.length > 64 ||
    !isPlace(bundle.start) ||
    !isPlace(bundle.goal) ||
    !Array.isArray(bundle.routes) ||
    bundle.routes.length !== 3 ||
    !bundle.routes.every(isRouteResult)
  ) {
    return false;
  }
  return new Set(bundle.routes.map((route) => route.mode)).size === 3;
}

function codedError(code: string) {
  return new Error(code);
}

export function calculateRouteBundleForPlaces(
  request: RoutePlacesRequest,
  options: RouteCalculationOptions = {},
): Promise<RouteBundle> {
  const {
    signal,
    timeoutMs = DEFAULT_ROUTE_TIMEOUT_MS,
    workerFactory = createRouteWorker,
  } = options;
  if (signal?.aborted) {
    return Promise.reject(codedError("ROUTE_CALCULATION_ABORTED"));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let worker: RouteWorkerLike;
    try {
      worker = workerFactory();
    } catch {
      reject(codedError("ROUTE_CALCULATION_FAILED"));
      return;
    }

    const finish = (result: { readonly value: RouteBundle } | { readonly error: string }) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onWorkerError);
      worker.removeEventListener("messageerror", onWorkerError);
      worker.terminate();
      if ("value" in result) resolve(result.value);
      else reject(codedError(result.error));
    };
    const onAbort = () => finish({ error: "ROUTE_CALCULATION_ABORTED" });
    const onWorkerError: EventListener = () =>
      finish({ error: "ROUTE_CALCULATION_FAILED" });
    const onMessage: EventListener = (event) => {
      const value = (event as MessageEvent<unknown>).data;
      if (typeof value !== "object" || value === null) {
        finish({ error: "ROUTE_CALCULATION_FAILED" });
        return;
      }
      const message = value as Record<string, unknown>;
      if (message.schema !== 1 || typeof message.ok !== "boolean") {
        finish({ error: "ROUTE_CALCULATION_FAILED" });
        return;
      }
      if (message.ok === true && isRouteBundle(message.bundle)) {
        finish({ value: message.bundle });
        return;
      }
      const code = typeof message.error === "string" ? message.error : "";
      finish({
        error: ROUTE_WORKER_ERROR_CODES.has(code)
          ? code
          : "ROUTE_CALCULATION_FAILED",
      });
    };
    const timeout = globalThis.setTimeout(
      () => finish({ error: "ROUTE_CALCULATION_TIMEOUT" }),
      timeoutMs,
    );

    signal?.addEventListener("abort", onAbort, { once: true });
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onWorkerError);
    worker.addEventListener("messageerror", onWorkerError);
    try {
      worker.postMessage({ schema: 1, request });
    } catch {
      finish({ error: "ROUTE_CALCULATION_FAILED" });
    }
  });
}
