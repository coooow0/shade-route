import { describe, expect, it } from "vitest";
import {
  assertRouteDataBudget,
  ROUTE_RESOURCE_LIMITS,
  type RouteDataWork,
} from "./resourceLimits";

const withinBudget: RouteDataWork = {
  ways: ROUTE_RESOURCE_LIMITS.routeWays,
  buildings: ROUTE_RESOURCE_LIMITS.routeBuildings,
  wayPoints: ROUTE_RESOURCE_LIMITS.routeWayPoints,
  buildingPoints: ROUTE_RESOURCE_LIMITS.routeBuildingPoints,
};

describe("route resource limits", () => {
  it("accepts work at the measured route-data budget", () => {
    expect(() => assertRouteDataBudget(withinBudget)).not.toThrow();
  });

  it.each(["ways", "buildings", "wayPoints", "buildingPoints"] as const)(
    "rejects %s before compact data expands",
    (field) => {
      expect(() =>
        assertRouteDataBudget({
          ...withinBudget,
          [field]: withinBudget[field] + 1,
        }),
      ).toThrow("ROUTE_DATA_TOO_COMPLEX");
    },
  );
});
