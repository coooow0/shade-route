import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  coordinateToTile,
  formatPlaceAddress,
  isBlockedWalkingNode,
  isFallbackRoad,
  isSupportedWalkingTags,
  isWalkableTags,
  limitPlacesByKind,
  normalizePlaceName,
  placeKindFromTags,
  pointInMultiPolygon,
  tileBounds,
  walkDirectionFromTags,
} from "./seoul-compiler-core.mjs";
import {
  artifactEntry,
  releaseIdFor,
  sha256Hex,
  verifySeoulArtifacts,
} from "./artifact-integrity.mjs";
import {
  boundaryCoordinates,
  publicBoundaryPayload,
  runtimeBoundaryModulePayload,
  verifyPublicBoundaryArtifact,
  verifyRuntimeBoundaryArtifact,
} from "./seoul-boundary-artifacts.mjs";

const require = createRequire(import.meta.url);
const parseOSM = require("osm-pbf-parser");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pbfPath = resolve(
  root,
  process.argv[2] ?? "/private/tmp/south-korea-latest.osm.pbf",
);
const boundaryPath = resolve(
  root,
  process.argv[3] ?? "data-src/seoul-boundary.geojson",
);
const targetOutputDirectory = resolve(
  root,
  process.argv[4] ?? "public/data/seoul",
);
const outputDirectory = join(
  dirname(targetOutputDirectory),
  `.${basename(targetOutputDirectory)}.staging`,
);
const integrityModulePath = resolve(
  root,
  "src/data/seoulArtifactIntegrity.mjs",
);
const runtimeBoundaryModulePath = resolve(root, "src/data/seoulBoundary.ts");

const ZOOM = 15;
const BBOX_MARGIN = 0.015;
const MAX_ELEMENT_TILES = 32;
const MAX_GEOMETRY_POINTS = 1_000;
const MAX_TILE_BYTES = 2_000_000;
const MAX_TOTAL_TILE_BYTES = 70_000_000;
const MAX_PLACES = 50_000;
const MAX_PLACE_TEXT_LENGTH = 120;
const MAX_PLACE_BYTES = 12_000_000;
const MAX_POLICY_ENTRIES = 20_000;
const MICRO_DEGREES = 1_000_000;

function coordinatesBounds(coordinates) {
  const points = coordinates.flat(3);
  const lons = points.filter((_, index) => index % 2 === 0);
  const lats = points.filter((_, index) => index % 2 === 1);
  return {
    south: Math.min(...lats),
    west: Math.min(...lons),
    north: Math.max(...lats),
    east: Math.max(...lons),
  };
}

function inExpandedBounds(lat, lon, bounds) {
  return (
    lat >= bounds.south - BBOX_MARGIN &&
    lat <= bounds.north + BBOX_MARGIN &&
    lon >= bounds.west - BBOX_MARGIN &&
    lon <= bounds.east + BBOX_MARGIN
  );
}

function compactGeometry(geometry) {
  return geometry.flatMap(({ lat, lon }) => [
    Math.round(lat * MICRO_DEGREES),
    Math.round(lon * MICRO_DEGREES),
  ]);
}

function compactPositive(value, maximum) {
  if (typeof value !== "string") return null;
  const parsed = Number.parseFloat(value.replace(/m$/i, "").trim());
  return Number.isFinite(parsed) && parsed > 0 && parsed <= maximum
    ? Number(parsed.toFixed(2))
    : null;
}

function walkwayFlags(tags = {}) {
  const covered =
    tags.covered === "yes" ||
    (tags.tunnel !== undefined && tags.tunnel !== "no") ||
    tags.indoor === "yes" ||
    tags.highway === "corridor";
  return (
    (covered ? 1 : 0) |
    (tags.highway === "steps" ? 2 : 0) |
    (isFallbackRoad(tags) ? 4 : 0)
  );
}

function tileKey(x, y) {
  return `${ZOOM}-${x}-${y}`;
}

function getTile(tiles, x, y) {
  const id = tileKey(x, y);
  const existing = tiles.get(id);
  if (existing) return existing;
  const tile = { id, x, y, ways: [], buildings: [] };
  tiles.set(id, tile);
  return tile;
}

function geometryTiles(geometry) {
  const tilePoints = geometry.map((point) =>
    coordinateToTile(point.lat, point.lon, ZOOM),
  );
  const minX = Math.min(...tilePoints.map((point) => point.x));
  const maxX = Math.max(...tilePoints.map((point) => point.x));
  const minY = Math.min(...tilePoints.map((point) => point.y));
  const maxY = Math.max(...tilePoints.map((point) => point.y));
  const count = (maxX - minX + 1) * (maxY - minY + 1);
  if (count > MAX_ELEMENT_TILES) return [];
  const result = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) result.push({ x, y });
  }
  return result;
}

function centerOf(geometry) {
  const total = geometry.reduce(
    (sum, point) => ({ lat: sum.lat + point.lat, lon: sum.lon + point.lon }),
    { lat: 0, lon: 0 },
  );
  return {
    lat: total.lat / geometry.length,
    lon: total.lon / geometry.length,
  };
}

function placeFrom(item, lat, lon) {
  const kind = placeKindFromTags(item.tags);
  if (!kind) return null;
  const address = formatPlaceAddress(item.tags);
  const name = item.tags?.["name:ko"] ?? item.tags?.name ?? address;
  if (
    !name ||
    typeof name !== "string" ||
    name.trim().length === 0 ||
    name.length > MAX_PLACE_TEXT_LENGTH
  ) {
    return null;
  }
  if (kind === "station" && !/[^\d\s.-]/u.test(name)) return null;
  const aliases = [
    item.tags?.name,
    item.tags?.["name:en"],
    item.tags?.alt_name,
    item.tags?.short_name,
    item.tags?.brand,
  ].filter(
    (alias, index, values) =>
      typeof alias === "string" &&
      alias !== name &&
      alias.length <= MAX_PLACE_TEXT_LENGTH &&
      values.indexOf(alias) === index,
  );
  return {
    id: `osm-${item.type}-${item.id}`,
    name: name.trim(),
    aliases,
    ...(address && address !== name ? { address } : {}),
    kind,
    lat,
    lon,
  };
}

function dedupePlaces(places) {
  const deduped = new Map();
  for (const place of places) {
    const key =
      place.kind === "station"
        ? `station:${normalizePlaceName(place.name)}`
        : `${normalizePlaceName(place.name)}:${place.lat.toFixed(4)}:${place.lon.toFixed(4)}`;
    const existing = deduped.get(key);
    if (!existing || (place.address && !existing.address))
      deduped.set(key, place);
  }
  return [...deduped.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "ko"),
  );
}

const boundary = JSON.parse(await readFile(boundaryPath, "utf8"));
await rm(outputDirectory, { recursive: true, force: true });
const seoul = boundaryCoordinates(boundary);
const runtimeBoundaryPayload = runtimeBoundaryModulePayload(boundary).payload;
const bounds = coordinatesBounds(seoul);
const nodes = new Map();
const blockedNodeCandidates = new Set();
const blockedNodeIds = new Set();
const excludedWayIds = new Set();
const fallbackWayIds = new Set();
const wayDirections = new Map();
const tiles = new Map();
const places = [];
const stats = {
  parsed: 0,
  keptNodes: 0,
  walkways: 0,
  buildings: 0,
  missingGeometry: 0,
};

const source = createReadStream(pbfPath);
const parser = parseOSM();
const sourceHasher = createHash("sha256");
source.on("data", (chunk) => sourceHasher.update(chunk));

await new Promise((resolvePromise, rejectPromise) => {
  source.on("error", rejectPromise);
  parser.on("error", rejectPromise);
  parser.on("data", (batch) => {
    for (const item of batch) {
      stats.parsed++;
      if (item.type === "node") {
        if (!inExpandedBounds(item.lat, item.lon, bounds)) continue;
        nodes.set(item.id, { lat: item.lat, lon: item.lon });
        if (isBlockedWalkingNode(item.tags)) blockedNodeCandidates.add(item.id);
        stats.keptNodes++;
        if (
          placeKindFromTags(item.tags) &&
          pointInMultiPolygon([item.lon, item.lat], seoul)
        ) {
          const place = placeFrom(item, item.lat, item.lon);
          if (place) places.push(place);
        }
        continue;
      }
      if (item.type !== "way") continue;
      const walkingCandidate = isSupportedWalkingTags(item.tags);
      const walkable = walkingCandidate && isWalkableTags(item.tags);
      const isBuilding = item.tags?.building !== undefined;
      const placeKind = placeKindFromTags(item.tags);
      if (!walkingCandidate && !isBuilding && !placeKind) continue;
      const geometry = item.refs?.map((nodeId) => nodes.get(nodeId));
      if (
        !geometry ||
        geometry.length === 0 ||
        geometry.some((point) => !point) ||
        geometry.length > MAX_GEOMETRY_POINTS
      ) {
        stats.missingGeometry++;
        continue;
      }
      const center = centerOf(geometry);
      const inside =
        pointInMultiPolygon([center.lon, center.lat], seoul) ||
        geometry.some((point) =>
          pointInMultiPolygon([point.lon, point.lat], seoul),
        );
      if (!inside) continue;

      if (walkingCandidate && !walkable) excludedWayIds.add(item.id);

      if (walkable && geometry.length >= 2) {
        if (isFallbackRoad(item.tags)) fallbackWayIds.add(item.id);
        for (const nodeId of item.refs) {
          if (blockedNodeCandidates.has(nodeId)) blockedNodeIds.add(nodeId);
        }
        const walkDirection = walkDirectionFromTags(item.tags);
        if (walkDirection === "forward" || walkDirection === "backward") {
          wayDirections.set(item.id, walkDirection);
        }
        const element = JSON.stringify([
          item.id,
          walkwayFlags(item.tags),
          item.refs,
          compactGeometry(geometry),
        ]);
        for (const { x, y } of geometryTiles(geometry)) {
          getTile(tiles, x, y).ways.push(element);
        }
        stats.walkways++;
      }
      if (
        isBuilding &&
        geometry.length >= 3 &&
        pointInMultiPolygon([center.lon, center.lat], seoul)
      ) {
        const owner = coordinateToTile(center.lat, center.lon, ZOOM);
        getTile(tiles, owner.x, owner.y).buildings.push(
          JSON.stringify([
            item.id,
            compactPositive(
              item.tags?.height ?? item.tags?.["building:height"],
              1_000,
            ),
            compactPositive(item.tags?.["building:levels"], 300),
            compactGeometry(geometry),
          ]),
        );
        stats.buildings++;
      }
      if (placeKind && pointInMultiPolygon([center.lon, center.lat], seoul)) {
        const place = placeFrom(item, center.lat, center.lon);
        if (place) places.push(place);
      }
    }
    if (stats.parsed % 1_000_000 < batch.length) {
      console.error(
        JSON.stringify({
          parsed: stats.parsed,
          keptNodes: stats.keptNodes,
          walkways: stats.walkways,
          buildings: stats.buildings,
        }),
      );
    }
  });
  parser.on("end", resolvePromise);
  source.pipe(parser);
});
const sourceSha256 = sourceHasher.digest("hex");
const sourceStat = await stat(pbfPath);

await mkdir(join(outputDirectory, "tiles"), { recursive: true });
const manifestTiles = [];
for (const tile of [...tiles.values()].sort((a, b) =>
  a.id.localeCompare(b.id),
)) {
  const payload = `{"schema":2,"id":${JSON.stringify(tile.id)},"w":[${tile.ways.join(",")}],"b":[${tile.buildings.join(",")}]}`;
  const payloadBytes = Buffer.byteLength(payload);
  if (payloadBytes > MAX_TILE_BYTES) {
    throw new Error(`Tile ${tile.id} exceeds ${MAX_TILE_BYTES} bytes`);
  }
  await writeFile(join(outputDirectory, "tiles", `${tile.id}.json`), payload);
  manifestTiles.push({
    id: tile.id,
    bounds: tileBounds(tile.x, tile.y, ZOOM),
    bytes: payloadBytes,
    sha256: sha256Hex(payload),
  });
}

const dedupedPlaces = dedupePlaces(places);
const compiledPlaces = limitPlacesByKind(dedupedPlaces, {
  limits: {
    station: 1_000,
    cafe: 4_000,
    medical: 3_000,
    office: 3_000,
    park: 2_000,
    education: 3_000,
    landmark: 5_000,
    food: 7_000,
    store: 7_000,
    building: 10_000,
    address: 5_000,
  },
  maximum: MAX_PLACES,
});
const placesPayload = `${JSON.stringify({ schema: 2, places: compiledPlaces })}\n`;
if (Buffer.byteLength(placesPayload) > MAX_PLACE_BYTES) {
  throw new Error(`Place index exceeds ${MAX_PLACE_BYTES} bytes`);
}
const boundaryPayload = publicBoundaryPayload(boundary);
await writeFile(join(outputDirectory, "places.json"), placesPayload);
await writeFile(join(outputDirectory, "boundary.json"), boundaryPayload);

const walkingPolicy = {
  schema: 1,
  excludedWayIds: [...excludedWayIds].sort((a, b) => a - b),
  blockedNodeIds: [...blockedNodeIds].sort((a, b) => a - b),
  fallbackWayIds: [...fallbackWayIds].sort((a, b) => a - b),
  directions: [...wayDirections]
    .sort(([a], [b]) => a - b)
    .map(([id, direction]) => [id, direction === "forward" ? 1 : -1]),
};
for (const [name, values] of [
  ["excluded ways", walkingPolicy.excludedWayIds],
  ["blocked nodes", walkingPolicy.blockedNodeIds],
  ["fallback ways", walkingPolicy.fallbackWayIds],
  ["directed ways", walkingPolicy.directions],
]) {
  if (values.length > MAX_POLICY_ENTRIES) {
    throw new Error(`${name} exceed ${MAX_POLICY_ENTRIES} entries`);
  }
}

const downloadUrl = process.env.OSM_SOURCE_URL ?? null;
const downloadedAt = process.env.OSM_DOWNLOADED_AT ?? null;
if (downloadUrl !== null && !downloadUrl.startsWith("https://")) {
  throw new Error("OSM_SOURCE_URL must use https");
}
if (downloadedAt !== null && !Number.isFinite(Date.parse(downloadedAt))) {
  throw new Error("OSM_DOWNLOADED_AT must be an ISO date");
}
const descriptor = {
  schema: 3,
  zoom: ZOOM,
  coverage: bounds,
  source: {
    schema: 1,
    fileName: basename(pbfPath),
    bytes: sourceStat.size,
    sha256: sourceSha256,
    observedModifiedAt: sourceStat.mtime.toISOString(),
    downloadUrl,
    downloadedAt,
  },
  generator: {
    schema: 3,
    script: "scripts/build-seoul-tiles.mjs",
  },
  artifacts: {
    places: artifactEntry("places.json", placesPayload),
    boundary: artifactEntry("boundary.json", boundaryPayload),
  },
  tiles: manifestTiles,
  walkingPolicy,
};
const releaseId = releaseIdFor(descriptor);
const manifest = { ...descriptor, releaseId };
const manifestPayload = `${JSON.stringify(manifest)}\n`;
const integrity = {
  schema: 1,
  releaseId,
  manifestSha256: sha256Hex(manifestPayload),
  placesSha256: descriptor.artifacts.places.sha256,
};
await writeFile(join(outputDirectory, "manifest.json"), manifestPayload);

const totalBytes = manifestTiles.reduce((sum, tile) => sum + tile.bytes, 0);
if (totalBytes > MAX_TOTAL_TILE_BYTES) {
  throw new Error(`Seoul tiles exceed ${MAX_TOTAL_TILE_BYTES} bytes`);
}
const integrityModulePayload = `// Generated by scripts/build-seoul-tiles.mjs. Do not edit by hand.\nexport const SEOUL_ARTIFACT_INTEGRITY = Object.freeze(${JSON.stringify(integrity, null, 2)});\n`;
const integrityModuleTemporaryPath = `${integrityModulePath}.tmp`;
const runtimeBoundaryTemporaryPath = `${runtimeBoundaryModulePath}.tmp`;
await Promise.all([
  writeFile(integrityModuleTemporaryPath, integrityModulePayload),
  writeFile(runtimeBoundaryTemporaryPath, runtimeBoundaryPayload),
]);
await Promise.all([
  verifySeoulArtifacts(outputDirectory, integrity),
  verifyPublicBoundaryArtifact(
    boundaryPath,
    join(outputDirectory, "boundary.json"),
  ),
  verifyRuntimeBoundaryArtifact(boundaryPath, runtimeBoundaryTemporaryPath),
]);
await rm(targetOutputDirectory, { recursive: true, force: true });
await rename(outputDirectory, targetOutputDirectory);
await Promise.all([
  rename(integrityModuleTemporaryPath, integrityModulePath),
  rename(runtimeBoundaryTemporaryPath, runtimeBoundaryModulePath),
]);
await verifySeoulArtifacts(targetOutputDirectory, integrity);
await verifyPublicBoundaryArtifact(
  boundaryPath,
  join(targetOutputDirectory, "boundary.json"),
);
await verifyRuntimeBoundaryArtifact(boundaryPath, runtimeBoundaryModulePath);
console.log(
  JSON.stringify({
    ...stats,
    tiles: manifestTiles.length,
    places: compiledPlaces.length,
    placeCandidates: dedupedPlaces.length,
    totalBytes,
    largestTileBytes: Math.max(...manifestTiles.map((tile) => tile.bytes)),
    excludedWays: excludedWayIds.size,
    blockedNodes: blockedNodeIds.size,
    fallbackWays: fallbackWayIds.size,
    directedWays: wayDirections.size,
    releaseId,
    manifestSha256: integrity.manifestSha256,
    sourceSha256,
  }),
);
