import { describe, expect, it } from "vitest";
import ways from "../../../public/data/ways.json";
import buildings from "../../../public/data/buildings.json";
import { calculateFromData, PLACES } from "./routeService";

describe("real Gangnam corridor data", () => {
  it("keeps the shortest and maximum-shade invariants", () => {
    const result = calculateFromData({
      data: { ways, buildings },
      start: PLACES[0],
      goal: PLACES[1],
      at: new Date("2026-08-05T14:00:00+09:00"),
    });
    const [shortest, , maxShade] = result.routes;

    expect(shortest.timeSec).toBeLessThanOrEqual(maxShade.timeSec);
    expect(maxShade.sunSec).toBeLessThanOrEqual(shortest.sunSec);
    expect(shortest.segments.length).toBeGreaterThan(0);
    for (const route of result.routes) {
      for (let index = 1; index < route.segments.length; index++) {
        expect(route.segments[index].from).toEqual(
          route.segments[index - 1].to,
        );
      }
    }
  });
});
