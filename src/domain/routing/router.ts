import { distance } from "./geo";
import { ROUTE_RESOURCE_LIMITS } from "./resourceLimits";
import { FALLBACK_ROAD_MULTIPLIER } from "./safetyPolicy";
import type { ShadeService } from "./shade";
import type { Edge, Graph, XY } from "./types";

export const WALK_SPEED = 1.25;
export const MODE_WEIGHTS = { shortest: 0, balanced: 1, maxShade: 3 } as const;

interface HeapItem {
  readonly id: number;
  readonly score: number;
}

class MinHeap {
  private readonly items: HeapItem[] = [];

  push(item: HeapItem) {
    this.items.push(item);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.items[parent].score <= this.items[index].score) break;
      [this.items[parent], this.items[index]] = [
        this.items[index],
        this.items[parent],
      ];
      index = parent;
    }
  }

  pop(): HeapItem | undefined {
    const first = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0 && last) {
      this.items[0] = last;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (
          left < this.items.length &&
          this.items[left].score < this.items[smallest].score
        )
          smallest = left;
        if (
          right < this.items.length &&
          this.items[right].score < this.items[smallest].score
        )
          smallest = right;
        if (smallest === index) break;
        [this.items[smallest], this.items[index]] = [
          this.items[index],
          this.items[smallest],
        ];
        index = smallest;
      }
    }
    return first;
  }

  get size() {
    return this.items.length;
  }
}

export interface Path {
  readonly edges: readonly Edge[];
  readonly steps: readonly PathStep[];
}

interface PathStep {
  readonly edge: Edge;
  readonly fromNode: number;
  readonly toNode: number;
}

interface PreviousStep {
  readonly edge: Edge;
  readonly previousNode: number;
}

export interface XYRouteSegment {
  readonly from: XY;
  readonly to: XY;
  readonly shadeRatio: number;
  readonly covered: boolean;
  readonly steps: boolean;
  readonly connector?: boolean;
}

export interface RouteSummary {
  readonly timeSec: number;
  readonly lengthM: number;
  readonly sunSec: number;
  readonly shadeRatio: number;
  readonly segments: readonly XYRouteSegment[];
}

function edgeWalkTime(edge: Edge) {
  return (edge.length / WALK_SPEED) * (edge.steps ? 1.5 : 1);
}

export function astar(
  graph: Graph,
  startId: number,
  goalId: number,
  lambda: number,
  shade: ShadeService,
  fallbackRoadMultiplier = FALLBACK_ROAD_MULTIPLIER,
): Path | null {
  const goal = graph.nodes.get(goalId);
  if (!goal || !graph.nodes.has(startId)) return null;
  const heuristic = (id: number) => {
    const point = graph.nodes.get(id);
    return point
      ? distance(point, goal) / WALK_SPEED
      : Number.POSITIVE_INFINITY;
  };
  const costs = new Map<number, number>([[startId, 0]]);
  const from = new Map<number, PreviousStep>();
  const open = new MinHeap();
  const closed = new Set<number>();
  open.push({ id: startId, score: heuristic(startId) });

  while (open.size > 0) {
    const current = open.pop();
    if (!current || closed.has(current.id)) continue;
    closed.add(current.id);
    if (current.id === goalId) break;
    for (const edgeIndex of graph.adj.get(current.id) ?? []) {
      const edge = graph.edges[edgeIndex];
      if (!edge) continue;
      if (
        (edge.walkDirection === "forward" && current.id !== edge.a) ||
        (edge.walkDirection === "backward" && current.id !== edge.b)
      ) {
        continue;
      }
      const neighbor = edge.a === current.id ? edge.b : edge.a;
      if (closed.has(neighbor)) continue;
      const walkTime = edgeWalkTime(edge);
      const safetyMultiplier = edge.fallbackRoad ? fallbackRoadMultiplier : 1;
      const sunTime = walkTime * (1 - shade.edgeShadeRatio(edge));
      const nextCost =
        (costs.get(current.id) ?? Number.POSITIVE_INFINITY) +
        walkTime * safetyMultiplier +
        lambda * sunTime;
      if (nextCost < (costs.get(neighbor) ?? Number.POSITIVE_INFINITY)) {
        costs.set(neighbor, nextCost);
        from.set(neighbor, { edge, previousNode: current.id });
        open.push({ id: neighbor, score: nextCost + heuristic(neighbor) });
      }
    }
  }
  if (!from.has(goalId) && startId !== goalId) return null;
  const steps: PathStep[] = [];
  let node = goalId;
  while (node !== startId) {
    const previous = from.get(node);
    if (!previous) return null;
    steps.push({
      edge: previous.edge,
      fromNode: previous.previousNode,
      toNode: node,
    });
    node = previous.previousNode;
  }
  const orderedSteps = steps.reverse();
  return {
    edges: orderedSteps.map((step) => step.edge),
    steps: orderedSteps,
  };
}

export function summarize(
  path: Path,
  graph: Graph,
  shade: ShadeService,
): RouteSummary {
  if (path.steps.length > ROUTE_RESOURCE_LIMITS.routeSegments) {
    throw new Error("ROUTE_DATA_TOO_COMPLEX");
  }
  let timeSec = 0;
  let lengthM = 0;
  let sunSec = 0;
  const segments: XYRouteSegment[] = [];
  for (const step of path.steps) {
    const { edge } = step;
    const from = graph.nodes.get(step.fromNode);
    const to = graph.nodes.get(step.toNode);
    if (!from || !to) continue;
    const walkTime = edgeWalkTime(edge);
    const shadeRatio = shade.edgeShadeRatio(edge);
    timeSec += walkTime;
    lengthM += edge.length;
    sunSec += walkTime * (1 - shadeRatio);
    segments.push({
      from,
      to,
      shadeRatio,
      covered: edge.covered,
      steps: edge.steps,
    });
  }
  return {
    timeSec: Math.round(timeSec),
    lengthM: Math.round(lengthM),
    sunSec: Math.round(sunSec),
    shadeRatio: timeSec === 0 ? 0 : Number((1 - sunSec / timeSec).toFixed(3)),
    segments,
  };
}
