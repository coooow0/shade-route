import { isShaded, type ShadowIndex } from "./shadow";
import type { Edge, Graph } from "./types";

export interface ShadeService {
  readonly edgeShadeRatio: (edge: Edge) => number;
}

export function makeShadeService(
  graph: Graph,
  shadowIndex: ShadowIndex,
  slot: number,
  sunUp = true,
): ShadeService {
  const cache = new Map<string, number>();
  const edgeShadeRatio = (edge: Edge) => {
    if (!sunUp || edge.covered) return 1;
    const key = `${edge.id}:${slot}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const a = graph.nodes.get(edge.a);
    const b = graph.nodes.get(edge.b);
    if (!a || !b) return 0;
    const sampleCount = Math.min(100, Math.max(1, Math.ceil(edge.length / 10)));
    let shadedCount = 0;
    for (let index = 0; index < sampleCount; index++) {
      const t = (index + 0.5) / sampleCount;
      const point = [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
      ] as const;
      if (isShaded(point, shadowIndex)) shadedCount++;
    }
    const ratio = shadedCount / sampleCount;
    cache.set(key, ratio);
    return ratio;
  };
  return { edgeShadeRatio };
}
