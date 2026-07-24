import { describe, expect, it } from "vitest";
import ways from "../../test/fixtures/ways.synth.json";
import buildings from "../../test/fixtures/buildings.synth.json";
import { calculateFromData, PLACES } from "./routeService";

describe("calculateFromData", () => {
  it("prefers a short pedestrian detour over an unprotected fallback road", () => {
    const start = {
      id: "safe-start",
      name: "안전 경로 출발",
      lat: 37.498,
      lon: 127.032,
    } as const;
    const goal = {
      id: "safe-goal",
      name: "안전 경로 도착",
      lat: 37.498,
      lon: 127.033,
    } as const;
    const result = calculateFromData({
      data: {
        ways: {
          elements: [
            {
              type: "way",
              id: 1,
              tags: {
                highway: "footway",
                "shade-route:fallback": "yes",
              },
              nodes: [1, 2],
              geometry: [start, goal],
            },
            {
              type: "way",
              id: 2,
              tags: { highway: "footway" },
              nodes: [1, 3, 2],
              geometry: [start, { lat: 37.4982, lon: 127.0325 }, goal],
            },
          ],
        },
        buildings: { elements: [] },
      },
      start,
      goal,
      at: new Date("2026-08-05T14:00:00+09:00"),
    });

    expect(result.routes[0].segments).toHaveLength(2);
    expect(result.routes[0].pathKey).toBe("1:2");
  });

  it("uses fallback cost when choosing between nearby disconnected graphs", () => {
    const start = {
      id: "component-start",
      name: "컴포넌트 출발",
      lat: 37.498,
      lon: 127.032,
    } as const;
    const goal = {
      id: "component-goal",
      name: "컴포넌트 도착",
      lat: 37.498,
      lon: 127.033,
    } as const;
    const result = calculateFromData({
      data: {
        ways: {
          elements: [
            {
              type: "way",
              id: 10,
              tags: {
                highway: "footway",
                "shade-route:fallback": "yes",
              },
              nodes: [10, 11],
              geometry: [start, goal],
            },
            {
              type: "way",
              id: 20,
              tags: { highway: "footway" },
              nodes: [20, 21, 22],
              geometry: [
                { lat: 37.49805, lon: 127.032 },
                { lat: 37.4982, lon: 127.0325 },
                { lat: 37.49805, lon: 127.033 },
              ],
            },
          ],
        },
        buildings: { elements: [] },
      },
      start,
      goal,
      at: new Date("2026-08-05T14:00:00+09:00"),
    });

    expect(result.routes[0].segments).toHaveLength(4);
    expect(result.routes[0].segments[0].connector).toBe(true);
    expect(result.routes[0].segments[3].connector).toBe(true);
  });

  it("plans all three modes with valid geographic segments", () => {
    const result = calculateFromData({
      data: { ways, buildings },
      start: PLACES[0],
      goal: PLACES[1],
      at: new Date("2026-08-05T14:00:00+09:00"),
    });

    expect(result.routes.map((route) => route.mode)).toEqual([
      "shortest",
      "balanced",
      "maxShade",
    ]);
    expect(result.routes[0].timeSec).toBeLessThanOrEqual(
      result.routes[2].timeSec,
    );
    expect(result.routes[2].sunSec).toBeLessThanOrEqual(
      result.routes[0].sunSec,
    );
    for (const route of result.routes) {
      expect(route.segments.length).toBeGreaterThan(0);
      expect(route.segments[0].from.lat).toBeGreaterThan(37);
      expect(route.segments[0].from.lon).toBeGreaterThan(127);
      for (let index = 1; index < route.segments.length; index++) {
        expect(route.segments[index].from).toEqual(
          route.segments[index - 1].to,
        );
      }
    }
  });

  it("does not mutate the loaded source data", () => {
    const before = JSON.stringify({ ways, buildings });
    calculateFromData({
      data: { ways, buildings },
      start: PLACES[0],
      goal: PLACES[1],
      at: new Date("2026-08-05T14:00:00+09:00"),
    });

    expect(JSON.stringify({ ways, buildings })).toBe(before);
  });

  it("routes from a dynamic current-location place", () => {
    const currentPlace = {
      id: "current-location",
      name: "현재 위치",
      lat: 37.4998,
      lon: 127.031,
    } as const;

    const result = calculateFromData({
      data: { ways, buildings },
      start: currentPlace,
      goal: PLACES[1],
      at: new Date("2026-08-05T14:00:00+09:00"),
    });

    expect(result.start).toEqual(currentPlace);
    expect(result.routes).toHaveLength(3);
    expect(result.routes.every((route) => route.segments.length > 0)).toBe(
      true,
    );
    for (const route of result.routes) {
      const lastSegment = route.segments[route.segments.length - 1];
      expect(route.segments[0].from.lat).toBeCloseTo(currentPlace.lat, 6);
      expect(route.segments[0].from.lon).toBeCloseTo(currentPlace.lon, 6);
      expect(lastSegment?.to.lat).toBeCloseTo(PLACES[1].lat, 6);
      expect(lastSegment?.to.lon).toBeCloseTo(PLACES[1].lon, 6);
      expect(lastSegment?.connector).toBe(true);
    }
  });

  it("reports when a dynamic start snaps to the goal", () => {
    const currentAtGoal = {
      id: "current-location",
      name: "현재 위치",
      lat: PLACES[1].lat,
      lon: PLACES[1].lon,
    } as const;

    expect(() =>
      calculateFromData({
        data: { ways, buildings },
        start: currentAtGoal,
        goal: PLACES[1],
        at: new Date("2026-08-05T14:00:00+09:00"),
      }),
    ).toThrow("ALREADY_NEAR_GOAL");
  });
});
