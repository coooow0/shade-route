import type { RouteMode, RouteResult } from "../domain/routing/types";

export function walkMinutes(seconds: number) {
  return Math.max(1, Math.round(seconds / 60));
}

export function sunMinutes(seconds: number) {
  return Math.max(0, Math.round(seconds / 60));
}

export function distanceLabel(meters: number) {
  return meters >= 1_000 ? `${(meters / 1_000).toFixed(1)}km` : `${meters}m`;
}

export function routeByMode(routes: readonly RouteResult[], mode: RouteMode) {
  return routes.find((route) => route.mode === mode) ?? routes[0];
}
