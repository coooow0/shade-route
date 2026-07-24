const WALKABLE_HIGHWAYS = new Set([
  "footway",
  "pedestrian",
  "path",
  "steps",
  "living_street",
  "residential",
  "service",
  "corridor",
  "track",
  "unclassified",
]);

const CONDITIONAL_ROADS = new Set([
  "tertiary",
  "tertiary_link",
  "secondary",
  "secondary_link",
  "primary",
  "primary_link",
]);

const PUBLIC_FOOT_ACCESS = new Set(["yes", "designated", "permissive"]);
const TWO_WAY_VALUES = new Set(["no", "0", "false"]);
const FORWARD_VALUES = new Set(["yes", "1", "true"]);
const BACKWARD_VALUES = new Set(["-1", "reverse"]);
const DIFFICULT_SAC_SCALES = new Set([
  "demanding_mountain_hiking",
  "alpine_hiking",
  "demanding_alpine_hiking",
  "difficult_alpine_hiking",
]);

function normalized(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : undefined;
}

function isPublicAccess(value) {
  return value === undefined || PUBLIC_FOOT_ACCESS.has(value);
}

function sidewalkValues(tags) {
  return [
    tags.sidewalk,
    tags["sidewalk:left"],
    tags["sidewalk:right"],
    tags["sidewalk:both"],
  ].map(normalized);
}

function hasPedestrianSpace(tags) {
  if (PUBLIC_FOOT_ACCESS.has(normalized(tags.foot))) return true;
  return sidewalkValues(tags).some(
    (value) =>
      value !== undefined &&
      value !== "no" &&
      value !== "none" &&
      value !== "separate",
  );
}

function directionalPermission(value) {
  const access = normalized(value);
  if (access === undefined) return undefined;
  return PUBLIC_FOOT_ACCESS.has(access);
}

function combineDirections(first, second) {
  if (first === "both") return second;
  if (second === "both") return first;
  return first === second ? first : null;
}

export function isSupportedWalkingTags(tags = {}) {
  const highway = normalized(tags.highway) ?? "";
  return WALKABLE_HIGHWAYS.has(highway) || CONDITIONAL_ROADS.has(highway);
}

export function walkDirectionFromTags(tags = {}) {
  let direction = "both";
  const forward = directionalPermission(tags["foot:forward"]);
  const backward = directionalPermission(tags["foot:backward"]);
  if (forward === false && backward === false) return null;
  if (forward === false) direction = "backward";
  if (backward === false) direction = "forward";

  const footOneway = normalized(tags["oneway:foot"]);
  if (footOneway !== undefined) {
    const explicit = TWO_WAY_VALUES.has(footOneway)
      ? "both"
      : FORWARD_VALUES.has(footOneway)
        ? "forward"
        : BACKWARD_VALUES.has(footOneway)
          ? "backward"
          : null;
    if (explicit === null) return null;
    direction = combineDirections(direction, explicit);
    if (direction === null) return null;
  }

  const conveying = normalized(tags.conveying);
  if (conveying !== undefined && conveying !== "no") {
    const explicit =
      conveying === "forward"
        ? "forward"
        : conveying === "backward"
          ? "backward"
          : null;
    if (explicit === null) return null;
    direction = combineDirections(direction, explicit);
  }
  return direction;
}

export function isWalkableTags(tags = {}) {
  if (!isSupportedWalkingTags(tags)) return false;
  if (normalized(tags.motorroad) === "yes") return false;
  if (
    normalized(tags.disused) === "yes" ||
    normalized(tags.abandoned) === "yes"
  ) {
    return false;
  }
  if (DIFFICULT_SAC_SCALES.has(normalized(tags.sac_scale))) return false;
  if (
    tags["access:conditional"] !== undefined ||
    tags["foot:conditional"] !== undefined
  ) {
    return false;
  }

  const foot = normalized(tags.foot);
  const access = normalized(tags.access);
  if (foot !== undefined) {
    if (!PUBLIC_FOOT_ACCESS.has(foot)) return false;
  } else if (!isPublicAccess(access)) {
    return false;
  }

  const highway = normalized(tags.highway) ?? "";
  const sidewalks = sidewalkValues(tags);
  if (
    CONDITIONAL_ROADS.has(highway) &&
    !hasPedestrianSpace(tags) &&
    sidewalks.some(
      (value) => value === "no" || value === "none" || value === "separate",
    )
  ) {
    return false;
  }
  return walkDirectionFromTags(tags) !== null;
}

export function isFallbackRoad(tags = {}) {
  if (normalized(tags.sac_scale) === "mountain_hiking") return true;
  const highway = normalized(tags.highway) ?? "";
  if (!CONDITIONAL_ROADS.has(highway) && !WALKABLE_HIGHWAYS.has(highway)) {
    return false;
  }
  if (sidewalkValues(tags).some((value) => value === "separate")) return true;
  return CONDITIONAL_ROADS.has(highway) && !hasPedestrianSpace(tags);
}

export function isBlockedWalkingNode(tags = {}) {
  if (normalized(tags.locked) === "yes") return true;
  if (
    tags["access:conditional"] !== undefined ||
    tags["foot:conditional"] !== undefined
  ) {
    return true;
  }
  const foot = normalized(tags.foot);
  if (foot !== undefined) return !PUBLIC_FOOT_ACCESS.has(foot);
  return !isPublicAccess(normalized(tags.access));
}
