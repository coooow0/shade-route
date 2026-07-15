import type { LatLng, RouteSegment } from "./types";

export type DirectionKind =
  | "depart"
  | "straight"
  | "slight-left"
  | "left"
  | "slight-right"
  | "right"
  | "uturn-left"
  | "uturn-right"
  | "connector"
  | "steps"
  | "arrive";

export type DirectionExposure = "shade" | "sun" | "mixed" | "connector";

export interface WalkingDirection {
  readonly id: string;
  readonly kind: DirectionKind;
  readonly instruction: string;
  readonly distanceM: number;
  readonly shadeRatio: number;
  readonly exposure: DirectionExposure;
  readonly hasSteps: boolean;
  readonly from: LatLng;
  readonly to: LatLng;
}

interface DirectionGroup {
  readonly kind: DirectionKind;
  readonly distanceM: number;
  readonly shadedM: number;
  readonly hasSteps: boolean;
  readonly connector: boolean;
  readonly firstBearing: number;
  readonly lastBearing: number;
  readonly from: LatLng;
  readonly to: LatLng;
}

interface DirectionGroupList {
  readonly value: DirectionGroup;
  readonly previous: DirectionGroupList | null;
  readonly size: number;
}

const EARTH_RADIUS_M = 6_371_000;
const MIN_SEGMENT_M = 0.5;
const JITTER_SEGMENT_M = 8;
const TURN_STEP_DEGREES = 45;

function radians(value: number) {
  return (value * Math.PI) / 180;
}

function validPoint(point: LatLng) {
  return Number.isFinite(point.lat) && Number.isFinite(point.lon);
}

export function geoDistanceM(a: LatLng, b: LatLng) {
  const dLat = radians(b.lat - a.lat);
  const dLon = radians(b.lon - a.lon);
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(value)));
}

export function bearingDegrees(from: LatLng, to: LatLng) {
  const meanLat = radians((from.lat + to.lat) / 2);
  const east = (to.lon - from.lon) * Math.cos(meanLat);
  const north = to.lat - from.lat;
  return (Math.atan2(east, north) * 180) / Math.PI + 360;
}

function turnDelta(before: number, after: number) {
  return ((after - before + 540) % 360) - 180;
}

export function turnKind(before: number, after: number): DirectionKind {
  const delta = turnDelta(before, after);
  const magnitude = Math.abs(delta);
  if (magnitude < 15) return "straight";
  if (magnitude < 45) return delta > 0 ? "slight-right" : "slight-left";
  if (magnitude < 160) return delta > 0 ? "right" : "left";
  if (magnitude === 180) return "uturn-right";
  return delta > 0 ? "uturn-right" : "uturn-left";
}

function segmentSemantics(
  segment: RouteSegment,
): "connector" | "steps" | "walk" {
  if (segment.connector) return "connector";
  if (segment.steps) return "steps";
  return "walk";
}

function effectiveShade(segment: RouteSegment) {
  if (segment.covered) return 1;
  return Math.max(0, Math.min(1, segment.shadeRatio));
}

function addToGroup(
  group: DirectionGroup,
  segment: RouteSegment,
  length: number,
  bearing: number,
  keepBearing: boolean,
): DirectionGroup {
  return {
    ...group,
    distanceM: group.distanceM + length,
    shadedM: group.shadedM + length * effectiveShade(segment),
    hasSteps: group.hasSteps || Boolean(segment.steps),
    lastBearing: keepBearing ? group.lastBearing : bearing,
    to: segment.to,
  };
}

function cardinalDirection(bearing: number) {
  const labels = [
    "북쪽",
    "북동쪽",
    "동쪽",
    "남동쪽",
    "남쪽",
    "남서쪽",
    "서쪽",
    "북서쪽",
  ];
  return labels[Math.round(bearing / 45) % labels.length];
}

function instructionFor(group: DirectionGroup, index: number, total: number) {
  if (group.kind === "connector") {
    if (index === 0) return "보행로까지 이동";
    if (index === total - 1) return "도착지까지 이동";
    return "연결 구간 이동";
  }
  if (group.kind === "steps") return "계단 이용";
  if (group.kind === "depart") {
    return `${cardinalDirection(group.firstBearing)} 방향으로 ${index === 0 ? "출발" : "이동"}`;
  }
  if (group.kind === "straight") return "계속 직진";
  if (group.kind === "slight-left") return "왼쪽 방향으로 완만하게 이동";
  if (group.kind === "slight-right") return "오른쪽 방향으로 완만하게 이동";
  if (group.kind === "left") return "왼쪽으로 돌아 이동";
  if (group.kind === "right") return "오른쪽으로 돌아 이동";
  if (group.kind === "uturn-left") return "왼쪽으로 크게 돌아 이동";
  return "오른쪽으로 크게 돌아 이동";
}

function exposureFor(
  group: DirectionGroup,
  shadeRatio: number,
): DirectionExposure {
  if (group.connector) return "connector";
  if (shadeRatio >= 0.55) return "shade";
  if (shadeRatio <= 0.35) return "sun";
  return "mixed";
}

export function buildWalkingDirections(
  segments: readonly RouteSegment[],
  goalName: string,
): readonly WalkingDirection[] {
  const usable = segments
    .map((segment) => ({
      segment,
      length:
        validPoint(segment.from) && validPoint(segment.to)
          ? geoDistanceM(segment.from, segment.to)
          : Number.NaN,
    }))
    .filter(({ length }) => Number.isFinite(length) && length >= MIN_SEGMENT_M);

  let groupList: DirectionGroupList | null = null;
  for (let index = 0; index < usable.length; index++) {
    const { segment, length } = usable[index];
    const bearing = bearingDegrees(segment.from, segment.to) % 360;
    const semantics = segmentSemantics(segment);
    const previous: DirectionGroup | undefined = groupList?.value;
    if (!previous) {
      groupList = {
        value: {
          kind:
            semantics === "connector"
              ? "connector"
              : semantics === "steps"
                ? "steps"
                : "depart",
          distanceM: length,
          shadedM: length * effectiveShade(segment),
          hasSteps: Boolean(segment.steps),
          connector: Boolean(segment.connector),
          firstBearing: bearing,
          lastBearing: bearing,
          from: segment.from,
          to: segment.to,
        },
        previous: null,
        size: 1,
      };
      continue;
    }

    const previousSemantics: "connector" | "steps" | "walk" = previous.connector
      ? "connector"
      : previous.hasSteps && previous.kind === "steps"
        ? "steps"
        : "walk";
    const gap = geoDistanceM(previous.to, segment.from);
    const delta = Math.abs(turnDelta(previous.lastBearing, bearing));
    const next = usable[index + 1];
    const nextSemantics = next ? segmentSemantics(next.segment) : undefined;
    const nextBearing = next
      ? bearingDegrees(next.segment.from, next.segment.to) % 360
      : undefined;
    const returnsToPreviousDirection: boolean =
      nextBearing !== undefined &&
      Math.abs(turnDelta(previous.lastBearing, nextBearing)) < 25;
    const shortJitter: boolean =
      length < JITTER_SEGMENT_M &&
      semantics === previousSemantics &&
      nextSemantics === semantics &&
      returnsToPreviousDirection;
    const reverseSpike: boolean =
      length <= 15 &&
      semantics === previousSemantics &&
      nextSemantics === semantics &&
      delta >= 135 &&
      nextBearing !== undefined &&
      Math.abs(turnDelta(bearing, nextBearing)) >= 135 &&
      returnsToPreviousDirection;
    const jitter: boolean = shortJitter || reverseSpike;
    const split =
      gap > 10 ||
      semantics !== previousSemantics ||
      (semantics === "walk" && !jitter && delta >= TURN_STEP_DEGREES);

    if (!split) {
      groupList = {
        value: addToGroup(previous, segment, length, bearing, jitter),
        previous: groupList?.previous ?? null,
        size: groupList?.size ?? 1,
      };
      continue;
    }

    const kind: DirectionKind =
      semantics === "connector"
        ? "connector"
        : semantics === "steps"
          ? "steps"
          : gap > 10 || previousSemantics === "connector"
            ? "depart"
            : turnKind(previous.lastBearing, bearing);
    groupList = {
      value: {
        kind,
        distanceM: length,
        shadedM: length * effectiveShade(segment),
        hasSteps: Boolean(segment.steps),
        connector: Boolean(segment.connector),
        firstBearing: bearing,
        lastBearing: bearing,
        from: segment.from,
        to: segment.to,
      },
      previous: groupList,
      size: (groupList?.size ?? 0) + 1,
    };
  }

  if (groupList === null) return [];
  const groups = Array<DirectionGroup>(groupList.size);
  let current: DirectionGroupList | null = groupList;
  let groupIndex = groupList.size - 1;
  while (current !== null) {
    groups[groupIndex] = current.value;
    current = current.previous;
    groupIndex--;
  }

  const steps = groups.map((group, index): WalkingDirection => {
    const shadeRatio =
      group.distanceM === 0 ? 0 : group.shadedM / group.distanceM;
    return {
      id: `direction-${index}`,
      kind: group.kind,
      instruction: instructionFor(group, index, groups.length),
      distanceM: group.distanceM,
      shadeRatio,
      exposure: exposureFor(group, shadeRatio),
      hasSteps: group.hasSteps,
      from: group.from,
      to: group.to,
    };
  });
  const last = groups[groups.length - 1];
  return [
    ...steps,
    {
      id: "direction-arrive",
      kind: "arrive",
      instruction: `${goalName}에 도착`,
      distanceM: 0,
      shadeRatio: 0,
      exposure: "mixed",
      hasSteps: false,
      from: last.to,
      to: last.to,
    },
  ];
}
