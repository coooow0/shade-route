import RBush from "rbush";
import { convexHull, pointInPolygon } from "./geo";
import { shadowLength, type SunState } from "./sun";
import type { Building, XY } from "./types";

export interface ShadowItem {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly hull: readonly XY[];
}

export type ShadowIndex = RBush<ShadowItem>;

export function buildShadowIndex(
  buildings: readonly Building[],
  sun: SunState,
): ShadowIndex {
  const items: ShadowItem[] = [];
  for (const building of buildings) {
    if (building.poly.length < 3) continue;
    const length = shadowLength(building.height, sun);
    const shifted = building.poly.map<XY>(([x, y]) => [
      x + sun.dx * length,
      y + sun.dy * length,
    ]);
    const hull = convexHull([...building.poly, ...shifted]);
    if (hull.length < 3) continue;
    const xs = hull.map(([x]) => x);
    const ys = hull.map(([, y]) => y);
    items.push({
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
      hull,
    });
  }
  const index = new RBush<ShadowItem>();
  index.load(items);
  return index;
}

export function isShaded(point: XY, index: ShadowIndex): boolean {
  return index
    .search({ minX: point[0], minY: point[1], maxX: point[0], maxY: point[1] })
    .some((item) => pointInPolygon(point, item.hull));
}
