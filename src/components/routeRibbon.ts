import { geoDistanceM } from "../domain/routing/directions";
import type { RouteResult } from "../domain/routing/types";

export type RibbonKind = "shade" | "sun" | "connector";

export interface RibbonPart {
  readonly kind: RibbonKind;
  readonly meters: number;
}

// 구간마다 조각을 하나씩 그리면 1m짜리 실선이 수십 개 생겨 리본이 지저분해진다.
// 같은 성격(그늘/햇빛/접근)이 이어지면 하나로 합쳐서 "어디서 햇빛을 받는지"만 남긴다.
export function ribbonParts(route: RouteResult): readonly RibbonPart[] {
  const parts: RibbonPart[] = [];
  for (const segment of route.segments) {
    const meters = geoDistanceM(segment.from, segment.to);
    if (!Number.isFinite(meters) || meters <= 0) continue;
    const kind: RibbonKind = segment.connector
      ? "connector"
      : segment.covered || segment.shadeRatio >= 0.5
        ? "shade"
        : "sun";
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) {
      parts[parts.length - 1] = { kind, meters: last.meters + meters };
      continue;
    }
    parts.push({ kind, meters });
  }
  return parts;
}
