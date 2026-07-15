import RBush from "rbush";
import { describe, expect, it } from "vitest";
import { ROUTE_RESOURCE_LIMITS } from "./resourceLimits";
import { isShaded, type ShadowItem } from "./shadow";

function overlappingItems(count: number): readonly ShadowItem[] {
  return Array.from({ length: count }, () => ({
    minX: -1,
    minY: -1,
    maxX: 1,
    maxY: 1,
    hull: [
      [2, 2],
      [3, 2],
      [2, 3],
    ],
  }));
}

describe("shadow query limits", () => {
  it("keeps ordinary indexed shadow checks working", () => {
    const index = new RBush<ShadowItem>();
    index.load([
      {
        minX: -1,
        minY: -1,
        maxX: 1,
        maxY: 1,
        hull: [
          [-1, -1],
          [1, -1],
          [0, 1],
        ],
      },
    ]);

    expect(isShaded([0, 0], index)).toBe(true);
  });

  it("rejects overlapping-building candidate amplification", () => {
    const index = new RBush<ShadowItem>();
    index.load(
      overlappingItems(ROUTE_RESOURCE_LIMITS.shadowCandidatesPerPoint + 1),
    );

    expect(() => isShaded([0, 0], index)).toThrow("ROUTE_DATA_TOO_COMPLEX");
  });
});
