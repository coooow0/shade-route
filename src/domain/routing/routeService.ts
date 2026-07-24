import { parseBuildings } from "./buildings";
import { distance, makeProjection } from "./geo";
import { buildGraph, connectedGraphs, snapPointsToGraph } from "./graph";
import { loadTiledRouteData } from "./tileRouteData";
import {
  MAX_ROUTE_DISTANCE_M,
  validateRouteLengths,
  validateSeoulRoute,
} from "./routeCoverage";
import {
  astar,
  MODE_WEIGHTS,
  summarize,
  WALK_SPEED,
  type RouteSummary,
} from "./router";
import { FALLBACK_ROAD_MULTIPLIER } from "./safetyPolicy";
import { makeShadeService } from "./shade";
import { buildShadowIndex } from "./shadow";
import { sunState, timeSlot } from "./sun";
import type {
  CorridorData,
  Place,
  RouteBundle,
  RouteMode,
  RoutePlacesRequest,
  RouteRequest,
  RouteResult,
  XY,
} from "./types";

const CENTER = { lat: 37.498, lon: 127.032 } as const;
const GPS_SNAP_DISTANCE_M = 100;
const NAMED_PLACE_SNAP_DISTANCE_M = 150;
const NO_SHADE = { edgeShadeRatio: () => 0 } as const;

export const PLACES: readonly [Place, Place] = [
  {
    id: "gangnam-11",
    name: "강남역 11번 출구",
    lat: 37.4995,
    lon: 127.0284,
  },
  {
    id: "yeoksam",
    name: "역삼역",
    lat: 37.5007,
    lon: 127.0364,
  },
];

const MODES: readonly { mode: RouteMode; label: string; lambda: number }[] = [
  { mode: "shortest", label: "빠른길", lambda: MODE_WEIGHTS.shortest },
  { mode: "balanced", label: "균형", lambda: MODE_WEIGHTS.balanced },
  { mode: "maxShade", label: "그늘우선", lambda: MODE_WEIGHTS.maxShade },
];

export interface CalculateFromDataInput {
  readonly data: CorridorData;
  readonly start: Place;
  readonly goal: Place;
  readonly at: Date;
}

function connectorSegment(from: XY, to: XY) {
  const lengthM = distance(from, to);
  if (lengthM < 0.5) return null;
  return {
    lengthM,
    timeSec: lengthM / WALK_SPEED,
    segment: {
      from,
      to,
      shadeRatio: 0,
      covered: false,
      steps: false,
      connector: true,
    },
  } as const;
}

function addAccessConnectors(
  summary: RouteSummary,
  start: XY,
  snappedStart: XY,
  snappedGoal: XY,
  goal: XY,
): RouteSummary {
  const connectors = [
    connectorSegment(start, snappedStart),
    connectorSegment(snappedGoal, goal),
  ];
  const connectorLength = connectors.reduce(
    (total, connector) => total + (connector?.lengthM ?? 0),
    0,
  );
  const connectorTime = connectors.reduce(
    (total, connector) => total + (connector?.timeSec ?? 0),
    0,
  );
  const timeSec = summary.timeSec + connectorTime;
  const sunSec = summary.sunSec + connectorTime;
  return {
    timeSec: Math.round(timeSec),
    lengthM: Math.round(summary.lengthM + connectorLength),
    sunSec: Math.round(sunSec),
    shadeRatio: timeSec === 0 ? 0 : Number((1 - sunSec / timeSec).toFixed(3)),
    segments: [
      ...(connectors[0] ? [connectors[0].segment] : []),
      ...summary.segments,
      ...(connectors[1] ? [connectors[1].segment] : []),
    ],
  };
}

export function calculateFromData({
  data,
  start,
  goal,
  at,
}: CalculateFromDataInput): RouteBundle {
  if (start.id === goal.id) throw new Error("SAME_PLACE");
  const projection = makeProjection(CENTER.lat, CENTER.lon);
  const baseGraph = buildGraph(data.ways, projection, data.walkingPolicy);
  if (baseGraph.nodes.size === 0) throw new Error("EMPTY_GRAPH");
  const requestedStart = projection.toXY(start.lat, start.lon);
  const requestedGoal = projection.toXY(goal.lat, goal.lon);
  const requestedPoints = [requestedStart, requestedGoal] as const;
  const snapDistances = [
    start.id === "current-location"
      ? GPS_SNAP_DISTANCE_M
      : NAMED_PLACE_SNAP_DISTANCE_M,
    goal.id === "current-location"
      ? GPS_SNAP_DISTANCE_M
      : NAMED_PLACE_SNAP_DISTANCE_M,
  ] as const;
  const snapCandidates = connectedGraphs(baseGraph).flatMap((component) => {
    const candidate = snapPointsToGraph(
      component,
      requestedPoints,
      snapDistances,
    );
    if (candidate.snapPoints.some((point) => point === null)) return [];
    const [candidateStartId, candidateGoalId] = candidate.nodeIds;
    if (candidateStartId === null || candidateGoalId === null) return [];
    const previewPath = astar(
      candidate.graph,
      candidateStartId,
      candidateGoalId,
      MODE_WEIGHTS.shortest,
      NO_SHADE,
      FALLBACK_ROAD_MULTIPLIER,
    );
    if (!previewPath) return [];
    const snapDistance = candidate.snapPoints.reduce(
      (total, point, index) =>
        total + (point ? distance(requestedPoints[index], point) : 0),
      0,
    );
    const routeCost = previewPath.edges.reduce(
      (total, edge) =>
        total +
        edge.length *
          (edge.steps ? 1.5 : 1) *
          (edge.fallbackRoad ? FALLBACK_ROAD_MULTIPLIER : 1),
      snapDistance,
    );
    return [{ candidate, routeCost }];
  });
  const snapped = snapCandidates.reduce<(typeof snapCandidates)[number] | null>(
    (best, current) =>
      best === null || current.routeCost < best.routeCost ? current : best,
    null,
  )?.candidate;
  if (!snapped) throw new Error("SNAP_FAILED");
  const [startId, goalId] = snapped.nodeIds;
  const [snappedStart, snappedGoal] = snapped.snapPoints;
  if (
    startId === null ||
    goalId === null ||
    snappedStart === null ||
    snappedGoal === null
  ) {
    throw new Error("SNAP_FAILED");
  }
  if (startId === goalId) throw new Error("ALREADY_NEAR_GOAL");

  const { buildings } = parseBuildings(data.buildings, projection);
  const sun = sunState(at, CENTER.lat, CENTER.lon);
  const shadowIndex = buildShadowIndex(buildings, sun);
  const shade = makeShadeService(
    snapped.graph,
    shadowIndex,
    timeSlot(at),
    sun.up,
  );

  const routes: RouteResult[] = MODES.map(({ mode, label, lambda }) => {
    const path = astar(
      snapped.graph,
      startId,
      goalId,
      lambda,
      shade,
      FALLBACK_ROAD_MULTIPLIER,
    );
    if (!path) throw new Error("ROUTE_NOT_FOUND");
    const summary = addAccessConnectors(
      summarize(path, snapped.graph, shade),
      requestedStart,
      snappedStart,
      snappedGoal,
      requestedGoal,
    );
    return {
      mode,
      label,
      pathKey: path.edges.map((edge) => edge.id).join(":"),
      ...summary,
      segments: summary.segments.map((segment) => {
        const [fromLat, fromLon] = projection.toLL(
          segment.from[0],
          segment.from[1],
        );
        const [toLat, toLon] = projection.toLL(segment.to[0], segment.to[1]);
        return {
          from: { lat: fromLat, lon: fromLon },
          to: { lat: toLat, lon: toLon },
          shadeRatio: segment.shadeRatio,
          covered: segment.covered,
          steps: segment.steps,
          connector: segment.connector,
        };
      }),
    };
  });

  const shortestRoute = routes.find((route) => route.mode === "shortest");
  if (!shortestRoute) throw new Error("ROUTE_NOT_FOUND");
  validateRouteLengths([shortestRoute.lengthM]);
  const boundedRoutes = routes.map((route) =>
    route.lengthM <= MAX_ROUTE_DISTANCE_M
      ? route
      : {
          ...shortestRoute,
          mode: route.mode,
          label: route.label,
        },
  );
  validateRouteLengths(boundedRoutes.map((route) => route.lengthM));

  return { requestedAt: at.toISOString(), start, goal, routes: boundedRoutes };
}

export async function calculateRouteBundle(
  request: RouteRequest,
): Promise<RouteBundle> {
  const start = PLACES.find((place) => place.id === request.startId);
  const goal = PLACES.find((place) => place.id === request.goalId);
  if (!start || !goal) throw new Error("UNKNOWN_PLACE");
  return calculateRouteBundleForPlaces({
    start,
    goal,
    offsetMinutes: request.offsetMinutes,
  });
}

export async function calculateRouteBundleForPlaces(
  request: RoutePlacesRequest,
): Promise<RouteBundle> {
  validateSeoulRoute(request.start, request.goal);
  const data = await loadTiledRouteData(request.start, request.goal);
  const at = new Date(Date.now() + request.offsetMinutes * 60 * 1_000);
  return calculateFromData({
    data,
    start: request.start,
    goal: request.goal,
    at,
  });
}
