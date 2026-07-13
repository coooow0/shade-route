import { distance, nearestOnSegment, type Projection } from "./geo";
import type { Edge, Graph, OverpassData, XY } from "./types";

const WALKABLE = new Set([
  "footway",
  "pedestrian",
  "path",
  "steps",
  "living_street",
  "residential",
  "service",
  "corridor",
  "track",
  "unclassified",
]);
const CONDITIONAL_ROADS = new Set([
  "tertiary",
  "tertiary_link",
  "secondary",
  "secondary_link",
  "primary",
  "primary_link",
]);

function isWalkable(tags: Readonly<Record<string, string | undefined>> = {}) {
  const highway = tags.highway ?? "";
  const pedestrianSpace =
    tags.foot === "yes" ||
    tags.foot === "designated" ||
    [
      tags.sidewalk,
      tags["sidewalk:left"],
      tags["sidewalk:right"],
      tags["sidewalk:both"],
    ].some(
      (value) =>
        value !== undefined &&
        value !== "no" &&
        value !== "none" &&
        value !== "separate",
    );
  const supported =
    WALKABLE.has(highway) ||
    (CONDITIONAL_ROADS.has(highway) && pedestrianSpace);
  if (!supported || tags.foot === "no") return false;
  if (tags.motorroad === "yes") return false;
  if (
    (tags.access === "private" || tags.access === "no") &&
    tags.foot !== "yes" &&
    tags.foot !== "designated"
  ) {
    return false;
  }
  return true;
}

function isCovered(tags: Readonly<Record<string, string | undefined>> = {}) {
  return (
    tags.covered === "yes" ||
    (tags.tunnel !== undefined && tags.tunnel !== "no") ||
    tags.indoor === "yes" ||
    tags.highway === "corridor"
  );
}

function makeAdjacency(
  edges: readonly Edge[],
): ReadonlyMap<number, readonly number[]> {
  const adjacency = new Map<number, readonly number[]>();
  for (const edge of edges) {
    adjacency.set(edge.a, [...(adjacency.get(edge.a) ?? []), edge.id]);
    adjacency.set(edge.b, [...(adjacency.get(edge.b) ?? []), edge.id]);
  }
  return adjacency;
}

export function buildGraph(data: OverpassData, projection: Projection): Graph {
  const nodes = new Map<number, XY>();
  const edges: Edge[] = [];
  let skippedWays = 0;

  for (const element of data.elements) {
    if (element.type !== "way" || !element.geometry || !element.nodes) continue;
    if (!isWalkable(element.tags)) {
      skippedWays++;
      continue;
    }
    for (let index = 0; index < element.nodes.length - 1; index++) {
      const a = element.nodes[index];
      const b = element.nodes[index + 1];
      const geometryA = element.geometry[index];
      const geometryB = element.geometry[index + 1];
      if (a === undefined || b === undefined || !geometryA || !geometryB)
        continue;
      const pointA =
        nodes.get(a) ?? projection.toXY(geometryA.lat, geometryA.lon);
      const pointB =
        nodes.get(b) ?? projection.toXY(geometryB.lat, geometryB.lon);
      nodes.set(a, pointA);
      nodes.set(b, pointB);
      const length = distance(pointA, pointB);
      if (length <= 0) continue;
      edges.push({
        id: edges.length,
        a,
        b,
        length,
        covered: isCovered(element.tags),
        steps: element.tags?.highway === "steps",
        fallbackRoad: element.tags?.["shade-route:fallback"] === "yes",
        wayId: element.id,
      });
    }
  }

  return { nodes, edges, adj: makeAdjacency(edges), skippedWays };
}

export function largestComponent(graph: Graph): Graph {
  if (graph.nodes.size === 0)
    return { ...graph, componentCount: 0, droppedNodes: 0 };
  const seen = new Set<number>();
  const components: number[][] = [];
  for (const start of graph.nodes.keys()) {
    if (seen.has(start)) continue;
    const component: number[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const node = stack.pop();
      if (node === undefined) continue;
      component.push(node);
      for (const edgeIndex of graph.adj.get(node) ?? []) {
        const edge = graph.edges[edgeIndex];
        if (!edge) continue;
        const other = edge.a === node ? edge.b : edge.a;
        if (!seen.has(other)) {
          seen.add(other);
          stack.push(other);
        }
      }
    }
    components.push(component);
  }
  const biggest = components.reduce(
    (best, current) => (current.length > best.length ? current : best),
    [],
  );
  const keep = new Set(biggest);
  const edges = graph.edges
    .filter((edge) => keep.has(edge.a) && keep.has(edge.b))
    .map((edge, id) => ({ ...edge, id }));
  const nodes = new Map([...graph.nodes].filter(([id]) => keep.has(id)));
  return {
    ...graph,
    nodes,
    edges,
    adj: makeAdjacency(edges),
    componentCount: components.length,
    droppedNodes: graph.nodes.size - nodes.size,
  };
}

export function connectedGraphs(graph: Graph): readonly Graph[] {
  const seen = new Set<number>();
  const components: Graph[] = [];

  for (const start of graph.nodes.keys()) {
    if (seen.has(start)) continue;
    const nodeIds = new Set<number>([start]);
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const nodeId = stack.pop();
      if (nodeId === undefined) continue;
      for (const edgeIndex of graph.adj.get(nodeId) ?? []) {
        const edge = graph.edges[edgeIndex];
        if (!edge) continue;
        const other = edge.a === nodeId ? edge.b : edge.a;
        if (seen.has(other)) continue;
        seen.add(other);
        nodeIds.add(other);
        stack.push(other);
      }
    }
    const edges = graph.edges
      .filter((edge) => nodeIds.has(edge.a) && nodeIds.has(edge.b))
      .map((edge, id) => ({ ...edge, id }));
    if (edges.length === 0) continue;
    components.push({
      nodes: new Map(
        [...nodeIds].flatMap((id) => {
          const point = graph.nodes.get(id);
          return point ? [[id, point] as const] : [];
        }),
      ),
      edges,
      adj: makeAdjacency(edges),
      skippedWays: graph.skippedWays,
    });
  }

  return components;
}

interface SnapCandidate {
  readonly edge: Edge;
  readonly point: XY;
  readonly t: number;
  readonly distance: number;
}

export function snapPointsToGraph(
  graph: Graph,
  points: readonly XY[],
  maxDistance: number | readonly number[] = 100,
) {
  const nodes = new Map(graph.nodes);
  const nodeIds: Array<number | null> = Array(points.length).fill(null);
  const snapPoints: Array<XY | null> = Array(points.length).fill(null);
  const snapsByEdge = new Map<
    number,
    Array<{ pointIndex: number; point: XY; t: number }>
  >();
  const epsilon = 1e-9;

  points.forEach((point, pointIndex) => {
    const pointMaxDistance =
      typeof maxDistance === "number"
        ? maxDistance
        : (maxDistance[pointIndex] ?? 0);
    let best: SnapCandidate | null = null;
    for (const edge of graph.edges) {
      const a = graph.nodes.get(edge.a);
      const b = graph.nodes.get(edge.b);
      if (!a || !b) continue;
      const candidate = nearestOnSegment(point, a, b);
      if (
        candidate.distance <= pointMaxDistance &&
        (!best || candidate.distance < best.distance)
      ) {
        best = { edge, ...candidate };
      }
    }
    if (!best) return;
    snapPoints[pointIndex] = best.point;
    if (best.t <= epsilon) {
      nodeIds[pointIndex] = best.edge.a;
      return;
    }
    if (best.t >= 1 - epsilon) {
      nodeIds[pointIndex] = best.edge.b;
      return;
    }
    snapsByEdge.set(best.edge.id, [
      ...(snapsByEdge.get(best.edge.id) ?? []),
      { pointIndex, point: best.point, t: best.t },
    ]);
  });

  let nextVirtualId = -1;
  const takeVirtualId = () => {
    while (nodes.has(nextVirtualId)) nextVirtualId--;
    return nextVirtualId--;
  };
  const edges: Edge[] = [];
  const addEdge = (
    source: Edge,
    a: number,
    b: number,
    length: number,
    virtual = false,
  ) => {
    if (length <= 0) return;
    edges.push({
      ...source,
      id: edges.length,
      a,
      b,
      length,
      virtual: virtual || source.virtual,
    });
  };

  for (const edge of graph.edges) {
    const snaps = [...(snapsByEdge.get(edge.id) ?? [])].sort(
      (a, b) => a.t - b.t,
    );
    if (snaps.length === 0) {
      addEdge(edge, edge.a, edge.b, edge.length, Boolean(edge.virtual));
      continue;
    }
    const splits: Array<{ nodeId: number; t: number }> = [
      { nodeId: edge.a, t: 0 },
    ];
    for (const snap of snaps) {
      const previous = splits[splits.length - 1];
      if (Math.abs(previous.t - snap.t) <= epsilon) {
        nodeIds[snap.pointIndex] = previous.nodeId;
        continue;
      }
      const nodeId = takeVirtualId();
      nodes.set(nodeId, snap.point);
      nodeIds[snap.pointIndex] = nodeId;
      splits.push({ nodeId, t: snap.t });
    }
    splits.push({ nodeId: edge.b, t: 1 });
    for (let index = 0; index < splits.length - 1; index++) {
      const from = splits[index];
      const to = splits[index + 1];
      addEdge(
        edge,
        from.nodeId,
        to.nodeId,
        edge.length * (to.t - from.t),
        true,
      );
    }
  }

  return {
    graph: { ...graph, nodes, edges, adj: makeAdjacency(edges) },
    nodeIds,
    snapPoints,
  };
}
