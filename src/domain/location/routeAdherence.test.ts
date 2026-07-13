import { describe, expect, it } from "vitest";
import type { RouteSegment } from "../routing/types";
import type { LiveLocationSample } from "./liveLocation";
import {
  INITIAL_ROUTE_ADHERENCE,
  distanceToRouteM,
  updateRouteAdherence,
} from "./routeAdherence";

const route: readonly RouteSegment[] = [
  {
    from: { lat: 37.5, lon: 127 },
    to: { lat: 37.5, lon: 127.01 },
    shadeRatio: 0.5,
    covered: false,
  },
];

function sample(lat: number, lon: number, accuracyM = 5): LiveLocationSample {
  return { lat, lon, accuracyM, timestampMs: 1 };
}

describe("route adherence", () => {
  it("measures the nearest point on route segments, including endpoints", () => {
    const middleDistance = distanceToRouteM(sample(37.50045, 127.005), route);
    const endpointDistance = distanceToRouteM(sample(37.5, 127.011), route);

    expect(middleDistance).toBeCloseTo(49.7, 0);
    expect(endpointDistance).toBeCloseTo(88.2, 0);
    expect(distanceToRouteM(sample(37.5, 127), [])).toBeNull();
  });

  it("does not call a fix off-route while its accuracy overlaps the route", () => {
    const result = updateRouteAdherence(
      INITIAL_ROUTE_ADHERENCE,
      sample(37.50045, 127.005, 30),
      route,
    );

    expect(result).toMatchObject({ kind: "on-route", offRouteStreak: 0 });
  });

  it("requires three consecutive reliable off-route fixes", () => {
    const far = sample(37.501, 127.005, 5);
    const first = updateRouteAdherence(INITIAL_ROUTE_ADHERENCE, far, route);
    const second = updateRouteAdherence(first, far, route);
    const third = updateRouteAdherence(second, far, route);

    expect(first).toMatchObject({ kind: "checking", offRouteStreak: 1 });
    expect(second).toMatchObject({ kind: "checking", offRouteStreak: 2 });
    expect(third).toMatchObject({ kind: "off-route", offRouteStreak: 3 });
  });

  it("resets an off-route streak after an on-route or low-confidence fix", () => {
    const far = sample(37.501, 127.005, 5);
    const first = updateRouteAdherence(INITIAL_ROUTE_ADHERENCE, far, route);
    const second = updateRouteAdherence(first, far, route);
    const onRoute = updateRouteAdherence(
      second,
      sample(37.5, 127.005, 5),
      route,
    );
    const inaccurate = updateRouteAdherence(
      second,
      sample(37.501, 127.005, 70),
      route,
    );

    expect(onRoute).toMatchObject({ kind: "on-route", offRouteStreak: 0 });
    expect(inaccurate).toMatchObject({ kind: "checking", offRouteStreak: 0 });
  });

  it("returns new state without mutating its inputs", () => {
    const previous = { ...INITIAL_ROUTE_ADHERENCE };
    const frozenRoute = Object.freeze([...route]);
    const result = updateRouteAdherence(
      previous,
      sample(37.5, 127.005),
      frozenRoute,
    );

    expect(result).not.toBe(previous);
    expect(previous).toEqual(INITIAL_ROUTE_ADHERENCE);
    expect(frozenRoute).toEqual(route);
  });
});
