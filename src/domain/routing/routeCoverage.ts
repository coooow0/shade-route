import { isWithinSeoul } from "../location/serviceArea";
import type { Place } from "./types";

export const MAX_ROUTE_DISTANCE_M = 3_000;
const EARTH_RADIUS_M = 6_371_000;

function degreesToRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

export function directDistanceMeters(start: Place, goal: Place) {
  const startLatitude = degreesToRadians(start.lat);
  const goalLatitude = degreesToRadians(goal.lat);
  const latitudeDelta = goalLatitude - startLatitude;
  const longitudeDelta = degreesToRadians(goal.lon - start.lon);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) *
      Math.cos(goalLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(haversine));
}

export function validateSeoulRoute(start: Place, goal: Place) {
  if (
    !isWithinSeoul(start.lat, start.lon) ||
    !isWithinSeoul(goal.lat, goal.lon)
  ) {
    throw new Error("OUTSIDE_SEOUL");
  }
  if (directDistanceMeters(start, goal) > MAX_ROUTE_DISTANCE_M) {
    throw new Error("ROUTE_TOO_LONG");
  }
}

export function validateRouteLengths(lengths: readonly number[]) {
  if (
    lengths.length === 0 ||
    lengths.some(
      (length) => !Number.isFinite(length) || length > MAX_ROUTE_DISTANCE_M,
    )
  ) {
    throw new Error("ROUTE_TOO_LONG");
  }
}
