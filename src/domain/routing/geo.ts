import type { XY } from "./types";

export interface Projection {
  readonly toXY: (lat: number, lon: number) => XY;
  readonly toLL: (x: number, y: number) => readonly [number, number];
}

export function makeProjection(lat0: number, lon0: number): Projection {
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110_540;
  return {
    toXY: (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * ky],
    toLL: (x, y) => [y / ky + lat0, x / kx + lon0],
  };
}

export function distance(a: XY, b: XY): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function pointInPolygon(point: XY, polygon: readonly XY[]): boolean {
  const [x, y] = point;
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index++
  ) {
    const [xi, yi] = polygon[index];
    const [xj, yj] = polygon[previous];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function convexHull(points: readonly XY[]): readonly XY[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length <= 2) return sorted;
  const cross = (origin: XY, a: XY, b: XY) =>
    (a[0] - origin[0]) * (b[1] - origin[1]) -
    (a[1] - origin[1]) * (b[0] - origin[0]);
  const lower: XY[] = [];
  for (const point of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: XY[] = [];
  for (let index = sorted.length - 1; index >= 0; index--) {
    const point = sorted[index];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export function nearestOnSegment(point: XY, a: XY, b: XY) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const raw =
    lengthSquared === 0
      ? 0
      : ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared;
  const t = Math.max(0, Math.min(1, raw));
  const nearest: XY = [a[0] + t * dx, a[1] + t * dy];
  return { point: nearest, t, distance: distance(point, nearest) };
}
