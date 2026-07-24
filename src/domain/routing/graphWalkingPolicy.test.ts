import { describe, expect, it } from "vitest";
import { makeProjection } from "./geo";
import { buildGraph, snapPointsToGraph } from "./graph";
import type { Graph, OverpassData, WalkingPolicy } from "./types";

const projection = makeProjection(37.5, 127);
const ways: OverpassData = {
  elements: [
    {
      type: "way",
      id: 1,
      tags: { highway: "footway" },
      nodes: [10, 11],
      geometry: [
        { lat: 37.5, lon: 127 },
        { lat: 37.5, lon: 127.0001 },
      ],
    },
    {
      type: "way",
      id: 2,
      tags: { highway: "footway" },
      nodes: [20, 21, 22],
      geometry: [
        { lat: 37.5001, lon: 127 },
        { lat: 37.5001, lon: 127.0001 },
        { lat: 37.5001, lon: 127.0002 },
      ],
    },
  ],
};

function policy(overrides: Partial<WalkingPolicy> = {}): WalkingPolicy {
  return {
    excludedWayIds: new Set(),
    blockedNodeIds: new Set(),
    fallbackWayIds: new Set(),
    wayDirections: new Map(),
    ...overrides,
  };
}

describe("walking policy graph enforcement", () => {
  it("filters excluded ways before graph construction", () => {
    const graph = buildGraph(
      ways,
      projection,
      policy({ excludedWayIds: new Set([1]) }),
    );

    expect(graph.edges.map((edge) => edge.wayId)).toEqual([2, 2]);
    expect(graph.nodes.has(10)).toBe(false);
  });

  it("does not create segments through blocked barrier nodes", () => {
    const graph = buildGraph(
      ways,
      projection,
      policy({ blockedNodeIds: new Set([21]) }),
    );

    expect(graph.edges.map((edge) => edge.wayId)).toEqual([1]);
    expect(graph.nodes.has(21)).toBe(false);
  });

  it("attaches compiler-provided pedestrian directions", () => {
    const graph = buildGraph(
      ways,
      projection,
      policy({ wayDirections: new Map([[2, "backward"]]) }),
    );

    expect(
      graph.edges
        .filter((edge) => edge.wayId === 2)
        .map((edge) => edge.walkDirection),
    ).toEqual(["backward", "backward"]);
  });

  it("overlays fallback safety cost on cached way tags", () => {
    const graph = buildGraph(
      ways,
      projection,
      policy({ fallbackWayIds: new Set([2]) }),
    );

    expect(
      graph.edges
        .filter((edge) => edge.wayId === 2)
        .every((edge) => edge.fallbackRoad),
    ).toBe(true);
  });

  it("uses a finite fallback penalty when snapping to nearby edges", () => {
    const graph: Graph = {
      nodes: new Map([
        [1, [0, 0]],
        [2, [10, 0]],
        [3, [0, 10]],
        [4, [10, 10]],
      ]),
      edges: [
        {
          id: 0,
          a: 1,
          b: 2,
          length: 10,
          covered: false,
          steps: false,
          wayId: 1,
          fallbackRoad: true,
        },
        {
          id: 1,
          a: 3,
          b: 4,
          length: 10,
          covered: false,
          steps: false,
          wayId: 2,
        },
      ],
      adj: new Map([
        [1, [0]],
        [2, [0]],
        [3, [1]],
        [4, [1]],
      ]),
    };

    const saferSnap = snapPointsToGraph(graph, [[5, 4.5]], 20);
    const nearbyFallbackSnap = snapPointsToGraph(graph, [[5, 1]], 20);

    expect(saferSnap.snapPoints[0]).toEqual([5, 10]);
    expect(nearbyFallbackSnap.snapPoints[0]).toEqual([5, 0]);
  });
});
