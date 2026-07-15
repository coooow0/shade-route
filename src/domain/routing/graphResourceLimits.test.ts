import { describe, expect, it } from "vitest";
import { makeProjection } from "./geo";
import { buildGraph, connectedGraphs } from "./graph";
import { ROUTE_RESOURCE_LIMITS } from "./resourceLimits";
import type { OverpassData } from "./types";

function sharedNodeWays(count: number): OverpassData {
  return {
    elements: Array.from({ length: count }, (_, index) => ({
      type: "way",
      id: index + 1,
      tags: { highway: "footway" },
      nodes: [1, index + 2],
      geometry: [
        { lat: 37.5, lon: 127 },
        { lat: 37.5 + (index + 1) * 0.000001, lon: 127.0001 },
      ],
    })),
  };
}

function disconnectedWays(count: number): OverpassData {
  return {
    elements: Array.from({ length: count }, (_, index) => ({
      type: "way",
      id: index + 1,
      tags: { highway: "footway" },
      nodes: [index * 2 + 1, index * 2 + 2],
      geometry: [
        { lat: 37.5 + index * 0.000001, lon: 127 },
        { lat: 37.5 + index * 0.000001, lon: 127.0001 },
      ],
    })),
  };
}

const projection = makeProjection(37.5, 127);

describe("graph resource limits", () => {
  it("preserves a legitimate high-degree intersection at the limit", () => {
    expect(() =>
      buildGraph(
        sharedNodeWays(ROUTE_RESOURCE_LIMITS.graphNodeDegree),
        projection,
      ),
    ).not.toThrow();
  });

  it("rejects a degree-amplification graph", () => {
    expect(() =>
      buildGraph(
        sharedNodeWays(ROUTE_RESOURCE_LIMITS.graphNodeDegree + 1),
        projection,
      ),
    ).toThrow("ROUTE_DATA_TOO_COMPLEX");
  });

  it("rejects excessive disconnected components", () => {
    const graph = buildGraph(
      disconnectedWays(ROUTE_RESOURCE_LIMITS.graphComponents + 1),
      projection,
    );

    expect(() => connectedGraphs(graph)).toThrow("ROUTE_DATA_TOO_COMPLEX");
  });

  it("ignores repeated-node self loops without inflating degree counts", () => {
    const graph = buildGraph(
      {
        elements: [
          {
            type: "way",
            id: 1,
            tags: { highway: "footway" },
            nodes: [1, 1, 2],
            geometry: [
              { lat: 37.5, lon: 127 },
              { lat: 37.5, lon: 127 },
              { lat: 37.5001, lon: 127.0001 },
            ],
          },
        ],
      },
      projection,
    );

    expect(graph.edges).toHaveLength(1);
    expect(graph.adj.get(1)).toHaveLength(1);
    expect(graph.adj.get(2)).toHaveLength(1);
  });
});
