export interface RouteDataWork {
  readonly ways: number;
  readonly buildings: number;
  readonly wayPoints: number;
  readonly buildingPoints: number;
}

// Measured against the 2026-07 Seoul dataset. Runtime limits keep roughly
// 22-63% headroom over the densest observed tile or 36-tile corridor.
export const ROUTE_RESOURCE_LIMITS = {
  tileWays: 1_600,
  tileBuildings: 3_500,
  tileWayPoints: 8_000,
  tileBuildingPoints: 25_000,
  routeWays: 20_000,
  routeBuildings: 45_000,
  routeWayPoints: 110_000,
  routeBuildingPoints: 300_000,
  wayPointsPerElement: 512,
  buildingPointsPerElement: 256,
  graphNodes: 100_000,
  graphEdges: 100_000,
  graphNodeDegree: 64,
  graphComponents: 512,
  routeSegments: 2_000,
  directionSteps: 400,
  shadowCandidatesPerPoint: 512,
} as const;

function isCountWithin(value: number, maximum: number) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function assertWorkBudget(work: RouteDataWork, limits: RouteDataWork): void {
  if (
    !isCountWithin(work.ways, limits.ways) ||
    !isCountWithin(work.buildings, limits.buildings) ||
    !isCountWithin(work.wayPoints, limits.wayPoints) ||
    !isCountWithin(work.buildingPoints, limits.buildingPoints)
  ) {
    throw new Error("ROUTE_DATA_TOO_COMPLEX");
  }
}

export function assertTileDataBudget(work: RouteDataWork): void {
  assertWorkBudget(work, {
    ways: ROUTE_RESOURCE_LIMITS.tileWays,
    buildings: ROUTE_RESOURCE_LIMITS.tileBuildings,
    wayPoints: ROUTE_RESOURCE_LIMITS.tileWayPoints,
    buildingPoints: ROUTE_RESOURCE_LIMITS.tileBuildingPoints,
  });
}

export function assertRouteDataBudget(work: RouteDataWork): void {
  assertWorkBudget(work, {
    ways: ROUTE_RESOURCE_LIMITS.routeWays,
    buildings: ROUTE_RESOURCE_LIMITS.routeBuildings,
    wayPoints: ROUTE_RESOURCE_LIMITS.routeWayPoints,
    buildingPoints: ROUTE_RESOURCE_LIMITS.routeBuildingPoints,
  });
}
