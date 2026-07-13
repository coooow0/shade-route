import { makeProjection, nearestOnSegment } from "../routing/geo";
import type { RouteSegment } from "../routing/types";
import type { LiveLocationSample } from "./liveLocation";

const MAX_RELIABLE_ACCURACY_M = 50;
const ON_ROUTE_DISTANCE_M = 20;
const OFF_ROUTE_DISTANCE_M = 35;
const OFF_ROUTE_CONFIRMATIONS = 3;

export type RouteAdherenceKind = "on-route" | "checking" | "off-route";

export interface RouteAdherenceState {
  readonly kind: RouteAdherenceKind;
  readonly distanceM: number | null;
  readonly offRouteStreak: number;
}

export const INITIAL_ROUTE_ADHERENCE: RouteAdherenceState = Object.freeze({
  kind: "checking",
  distanceM: null,
  offRouteStreak: 0,
});

export function distanceToRouteM(
  sample: LiveLocationSample,
  segments: readonly RouteSegment[],
): number | null {
  if (segments.length === 0) return null;
  const projection = makeProjection(sample.lat, sample.lon);
  const point = projection.toXY(sample.lat, sample.lon);
  let minimum = Number.POSITIVE_INFINITY;

  for (const segment of segments) {
    const from = projection.toXY(segment.from.lat, segment.from.lon);
    const to = projection.toXY(segment.to.lat, segment.to.lon);
    minimum = Math.min(minimum, nearestOnSegment(point, from, to).distance);
  }

  return Number.isFinite(minimum) ? minimum : null;
}

export function updateRouteAdherence(
  previous: RouteAdherenceState,
  sample: LiveLocationSample,
  segments: readonly RouteSegment[],
): RouteAdherenceState {
  const distanceM = distanceToRouteM(sample, segments);
  if (distanceM === null || sample.accuracyM > MAX_RELIABLE_ACCURACY_M) {
    return { kind: "checking", distanceM, offRouteStreak: 0 };
  }

  const certainDistanceM = Math.max(0, distanceM - sample.accuracyM);
  if (certainDistanceM <= ON_ROUTE_DISTANCE_M) {
    return { kind: "on-route", distanceM, offRouteStreak: 0 };
  }
  if (certainDistanceM <= OFF_ROUTE_DISTANCE_M) {
    return { kind: "checking", distanceM, offRouteStreak: 0 };
  }

  const offRouteStreak = previous.offRouteStreak + 1;
  return {
    kind: offRouteStreak >= OFF_ROUTE_CONFIRMATIONS ? "off-route" : "checking",
    distanceM,
    offRouteStreak,
  };
}
