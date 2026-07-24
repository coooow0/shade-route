import { describe, expect, it } from "vitest";
import { snapPointsToGraph } from "./graph";
import { astar } from "./router";
import type { Graph } from "./types";

const shade = { edgeShadeRatio: () => 0 } as const;

function directedGraph(direction: "forward" | "backward"): Graph {
  return {
    nodes: new Map([
      [1, [0, 0]],
      [2, [10, 0]],
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
        walkDirection: direction,
      },
    ],
    adj: new Map([
      [1, [0]],
      [2, [0]],
    ]),
  } as Graph;
}

describe("pedestrian edge directions", () => {
  it("allows only the declared forward direction", () => {
    const graph = directedGraph("forward");

    expect(astar(graph, 1, 2, 0, shade)).not.toBeNull();
    expect(astar(graph, 2, 1, 0, shade)).toBeNull();
  });

  it("allows only the declared backward direction", () => {
    const graph = directedGraph("backward");

    expect(astar(graph, 2, 1, 0, shade)).not.toBeNull();
    expect(astar(graph, 1, 2, 0, shade)).toBeNull();
  });

  it("preserves direction when start and goal split the same edge", () => {
    const snapped = snapPointsToGraph(directedGraph("forward"), [
      [2, 0],
      [8, 0],
    ]);
    const [startId, goalId] = snapped.nodeIds;

    expect(startId).not.toBeNull();
    expect(goalId).not.toBeNull();
    expect(astar(snapped.graph, startId!, goalId!, 0, shade)).not.toBeNull();
    expect(astar(snapped.graph, goalId!, startId!, 0, shade)).toBeNull();
  });
});
