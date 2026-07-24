const SHA256_HEX = /^[a-f0-9]{64}$/;
const RELEASE_ID = /^[a-f0-9]{24}$/;
const TILE_ID = /^\d{1,2}-\d{1,8}-\d{1,8}$/;
const SOURCE_FILE_NAME = /^[a-zA-Z0-9._-]{1,120}$/;

export const TILE_MANIFEST_LIMITS = Object.freeze({
  artifactBytes: 12_000_000,
  manifestBytes: 1_000_000,
  policyEntries: 20_000,
  tileBytes: 2_000_000,
  tiles: 2_000,
});

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isBounds(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    isFiniteNumber(value.south) &&
    isFiniteNumber(value.west) &&
    isFiniteNumber(value.north) &&
    isFiniteNumber(value.east) &&
    value.south >= -90 &&
    value.north <= 90 &&
    value.west >= -180 &&
    value.east <= 180 &&
    value.south < value.north &&
    value.west < value.east
  );
}

function isSortedUniquePositiveIntegers(value) {
  return (
    Array.isArray(value) &&
    value.length <= TILE_MANIFEST_LIMITS.policyEntries &&
    value.every(
      (current, index) =>
        Number.isSafeInteger(current) &&
        current > 0 &&
        (index === 0 || current > value[index - 1]),
    )
  );
}

function isWalkingPolicy(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    value.schema === 1 &&
    isSortedUniquePositiveIntegers(value.excludedWayIds) &&
    isSortedUniquePositiveIntegers(value.blockedNodeIds) &&
    isSortedUniquePositiveIntegers(value.fallbackWayIds) &&
    Array.isArray(value.directions) &&
    value.directions.length <= TILE_MANIFEST_LIMITS.policyEntries &&
    value.directions.every(
      (entry, index) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        Number.isSafeInteger(entry[0]) &&
        entry[0] > 0 &&
        (entry[1] === 1 || entry[1] === -1) &&
        (index === 0 || entry[0] > value.directions[index - 1][0]),
    )
  );
}

function isArtifactEntry(value, expectedPath) {
  return (
    typeof value === "object" &&
    value !== null &&
    value.path === expectedPath &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes > 0 &&
    value.bytes <= TILE_MANIFEST_LIMITS.artifactBytes &&
    typeof value.sha256 === "string" &&
    SHA256_HEX.test(value.sha256)
  );
}

function isIsoDate(value) {
  return (
    typeof value === "string" &&
    value.length <= 40 &&
    Number.isFinite(Date.parse(value))
  );
}

function isSource(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    value.schema === 1 &&
    typeof value.fileName === "string" &&
    SOURCE_FILE_NAME.test(value.fileName) &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes > 0 &&
    typeof value.sha256 === "string" &&
    SHA256_HEX.test(value.sha256) &&
    isIsoDate(value.observedModifiedAt) &&
    (value.downloadUrl === null ||
      (typeof value.downloadUrl === "string" &&
        value.downloadUrl.length <= 2_000 &&
        value.downloadUrl.startsWith("https://"))) &&
    (value.downloadedAt === null || isIsoDate(value.downloadedAt))
  );
}

export function isTileManifestShape(value) {
  if (
    typeof value !== "object" ||
    value === null ||
    value.schema !== 3 ||
    typeof value.releaseId !== "string" ||
    !RELEASE_ID.test(value.releaseId) ||
    !Number.isInteger(value.zoom) ||
    value.zoom < 0 ||
    value.zoom > 22 ||
    !isBounds(value.coverage) ||
    !isSource(value.source) ||
    typeof value.generator !== "object" ||
    value.generator === null ||
    value.generator.schema !== 3 ||
    value.generator.script !== "scripts/build-seoul-tiles.mjs" ||
    typeof value.artifacts !== "object" ||
    value.artifacts === null ||
    !isArtifactEntry(value.artifacts.places, "places.json") ||
    !isArtifactEntry(value.artifacts.boundary, "boundary.json") ||
    !isWalkingPolicy(value.walkingPolicy) ||
    !Array.isArray(value.tiles) ||
    value.tiles.length === 0 ||
    value.tiles.length > TILE_MANIFEST_LIMITS.tiles
  ) {
    return false;
  }

  return value.tiles.every(
    (tile, index) =>
      typeof tile === "object" &&
      tile !== null &&
      TILE_ID.test(tile.id) &&
      (index === 0 || tile.id > value.tiles[index - 1].id) &&
      isBounds(tile.bounds) &&
      Number.isSafeInteger(tile.bytes) &&
      tile.bytes > 0 &&
      tile.bytes <= TILE_MANIFEST_LIMITS.tileBytes &&
      typeof tile.sha256 === "string" &&
      SHA256_HEX.test(tile.sha256),
  );
}
