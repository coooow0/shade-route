import { describe, expect, it } from "vitest";
import { snapPointsToGraph } from "./graph";
import type { Graph } from "./types";

const graph: Graph = {
  nodes: new Map([
    [1, [0, 0]],
    [2, [100, 0]],
  ]),
  edges: [
    {
      id: 0,
      a: 1,
      b: 2,
      length: 100,
      covered: false,
      steps: false,
      wayId: 10,
    },
  ],
  adj: new Map([
    [1, [0]],
    [2, [0]],
  ]),
};

describe("snapPointsToGraph", () => {
  it("supports a stricter GPS radius and a wider named-place radius", () => {
    const snapped = snapPointsToGraph(
      graph,
      [
        [50, 15],
        [75, 15],
      ],
      [10, 20],
    );

    expect(snapped.nodeIds[0]).toBeNull();
    expect(snapped.nodeIds[1]).not.toBeNull();
  });
});
