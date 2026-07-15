import { describe, expect, it } from "vitest";
import { ROUTE_RESOURCE_LIMITS } from "./resourceLimits";
import { summarize, type Path } from "./router";
import type { Edge, Graph } from "./types";

function linearPath(count: number) {
  const nodes = new Map<number, readonly [number, number]>();
  const edges: Edge[] = [];
  const steps: Array<{
    readonly edge: Edge;
    readonly fromNode: number;
    readonly toNode: number;
  }> = [];

  for (let index = 0; index <= count; index++) {
    nodes.set(index, [index, 0]);
  }
  for (let index = 0; index < count; index++) {
    const edge: Edge = {
      id: index,
      a: index,
      b: index + 1,
      length: 1,
      covered: false,
      steps: false,
      wayId: index + 1,
    };
    edges.push(edge);
    steps.push({ edge, fromNode: index, toNode: index + 1 });
  }

  const graph: Graph = { nodes, edges, adj: new Map() };
  const path: Path = { edges, steps };
  return { graph, path };
}

const shade = { edgeShadeRatio: () => 0 } as const;

describe("route output limits", () => {
  it("accepts a route at the segment budget", () => {
    const { graph, path } = linearPath(ROUTE_RESOURCE_LIMITS.routeSegments);

    expect(summarize(path, graph, shade).segments).toHaveLength(
      ROUTE_RESOURCE_LIMITS.routeSegments,
    );
  });

  it("rejects route-segment amplification before summary allocation", () => {
    const { graph, path } = linearPath(ROUTE_RESOURCE_LIMITS.routeSegments + 1);

    expect(() => summarize(path, graph, shade)).toThrow(
      "ROUTE_DATA_TOO_COMPLEX",
    );
  });
});
