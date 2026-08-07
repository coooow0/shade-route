import { describe, expect, it } from "vitest";
import type { RouteResult, RouteSegment } from "../domain/routing/types";
import { ribbonParts } from "./routeRibbon";

function segment(
  startLon: number,
  endLon: number,
  overrides: Partial<RouteSegment> = {},
): RouteSegment {
  return {
    from: { lat: 37.5, lon: startLon },
    to: { lat: 37.5, lon: endLon },
    shadeRatio: 0,
    covered: false,
    ...overrides,
  };
}

function route(segments: readonly RouteSegment[]): RouteResult {
  return {
    mode: "balanced",
    label: "균형",
    pathKey: "balanced",
    timeSec: 600,
    lengthM: 800,
    sunSec: 300,
    shadeRatio: 0.5,
    segments,
  };
}

describe("ribbonParts", () => {
  it("treats a covered segment as shade even when its shade ratio is low", () => {
    const parts = ribbonParts(
      route([segment(127, 127.001, { covered: true, shadeRatio: 0 })]),
    );

    expect(parts.map((part) => part.kind)).toEqual(["shade"]);
  });

  it("keeps connector semantics ahead of covered and shade values", () => {
    const parts = ribbonParts(
      route([
        segment(127, 127.001, {
          connector: true,
          covered: true,
          shadeRatio: 1,
        }),
      ]),
    );

    expect(parts.map((part) => part.kind)).toEqual(["connector"]);
  });

  it("merges adjacent segments with the same ribbon meaning", () => {
    const parts = ribbonParts(
      route([
        segment(127, 127.001, { connector: true }),
        segment(127.001, 127.002, { connector: true }),
        segment(127.002, 127.003, { covered: true }),
        segment(127.003, 127.004, { shadeRatio: 0.8 }),
        segment(127.004, 127.005),
      ]),
    );

    expect(parts.map((part) => part.kind)).toEqual([
      "connector",
      "shade",
      "sun",
    ]);
    expect(parts[0]?.meters).toBeGreaterThan(parts[2]?.meters ?? Infinity);
  });
});
