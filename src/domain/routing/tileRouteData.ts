import { fetchJsonWithLimit } from "../data/fetchJson";
import { SEOUL_ARTIFACT_INTEGRITY } from "../../data/seoulArtifactIntegrity.mjs";
import {
  assertRouteDataBudget,
  assertTileDataBudget,
  ROUTE_RESOURCE_LIMITS,
  type RouteDataWork,
} from "./resourceLimits";
import {
  isTileManifestShape,
  TILE_MANIFEST_LIMITS,
} from "./tileManifestValidation.mjs";
import type {
  CorridorData,
  LatLng,
  OverpassData,
  OverpassElement,
} from "./types";

const MAX_MANIFEST_BYTES = TILE_MANIFEST_LIMITS.manifestBytes;
const MAX_TILE_BYTES = TILE_MANIFEST_LIMITS.tileBytes;
const MAX_ROUTE_BYTES = TILE_MANIFEST_LIMITS.artifactBytes;
const MAX_ROUTE_TILES = 36;
const TILE_FETCH_CONCURRENCY = 6;
const DEFAULT_BUFFER_DEGREES = 0.01;
const DATA_DIRECTORY = "data/seoul";

export interface GeoBounds {
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
}

export interface TileManifestEntry {
  readonly id: string;
  readonly bounds: GeoBounds;
  readonly bytes: number;
  readonly sha256: string;
}

export interface ArtifactManifestEntry {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface SeoulArtifactIntegrity {
  readonly schema: 1;
  readonly releaseId: string;
  readonly manifestSha256: string;
  readonly placesSha256: string;
}

export interface TileManifest {
  readonly schema: 3;
  readonly releaseId: string;
  readonly zoom: number;
  readonly coverage: GeoBounds;
  readonly source: {
    readonly schema: 1;
    readonly fileName: string;
    readonly bytes: number;
    readonly sha256: string;
    readonly observedModifiedAt: string;
    readonly downloadUrl: string | null;
    readonly downloadedAt: string | null;
  };
  readonly generator: {
    readonly schema: 3;
    readonly script: "scripts/build-seoul-tiles.mjs";
  };
  readonly artifacts: {
    readonly places: ArtifactManifestEntry;
    readonly boundary: ArtifactManifestEntry;
  };
  readonly tiles: readonly TileManifestEntry[];
  readonly walkingPolicy: WalkingPolicyManifest;
}

export interface WalkingPolicyManifest {
  readonly schema: 1;
  readonly excludedWayIds: readonly number[];
  readonly blockedNodeIds: readonly number[];
  readonly fallbackWayIds: readonly number[];
  readonly directions: readonly (readonly [number, 1 | -1])[];
}

interface RouteDataTile {
  readonly schema: 1;
  readonly id: string;
  readonly ways: OverpassData;
  readonly buildings: OverpassData;
}

interface CompactRouteDataTile {
  readonly schema: 2;
  readonly id: string;
  readonly w: readonly unknown[];
  readonly b: readonly unknown[];
}

const MICRO_DEGREES = 1_000_000;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isTileManifest(value: unknown): value is TileManifest {
  return isTileManifestShape(value);
}

function isCompactCoordinates(
  value: unknown,
  minimumPoints: number,
  maximumPoints: number,
): value is readonly number[] {
  return (
    Array.isArray(value) &&
    value.length >= minimumPoints * 2 &&
    value.length <= maximumPoints * 2 &&
    value.length % 2 === 0 &&
    value.every(
      (coordinate, index) =>
        Number.isInteger(coordinate) &&
        (index % 2 === 0
          ? coordinate >= -90 * MICRO_DEGREES &&
            coordinate <= 90 * MICRO_DEGREES
          : coordinate >= -180 * MICRO_DEGREES &&
            coordinate <= 180 * MICRO_DEGREES),
    )
  );
}

function isCompactWay(value: unknown) {
  if (!Array.isArray(value) || value.length !== 4) return false;
  const [id, flags, nodes, coordinates] = value;
  return (
    Number.isSafeInteger(id) &&
    id > 0 &&
    Number.isInteger(flags) &&
    flags >= 0 &&
    flags <= 7 &&
    Array.isArray(nodes) &&
    nodes.length >= 2 &&
    nodes.length <= ROUTE_RESOURCE_LIMITS.wayPointsPerElement &&
    nodes.every((node) => Number.isSafeInteger(node) && node > 0) &&
    isCompactCoordinates(
      coordinates,
      2,
      ROUTE_RESOURCE_LIMITS.wayPointsPerElement,
    ) &&
    coordinates.length === nodes.length * 2
  );
}

function isOptionalPositiveNumber(value: unknown, maximum: number) {
  return (
    value === null || (isFiniteNumber(value) && value > 0 && value <= maximum)
  );
}

function isCompactBuilding(value: unknown) {
  if (!Array.isArray(value) || value.length !== 4) return false;
  const [id, height, levels, coordinates] = value;
  return (
    Number.isSafeInteger(id) &&
    id > 0 &&
    isOptionalPositiveNumber(height, 1_000) &&
    isOptionalPositiveNumber(levels, 300) &&
    isCompactCoordinates(
      coordinates,
      3,
      ROUTE_RESOURCE_LIMITS.buildingPointsPerElement,
    )
  );
}

function isCompactRouteDataTile(
  value: unknown,
  expectedId: string,
): value is CompactRouteDataTile {
  if (typeof value !== "object" || value === null) return false;
  const tile = value as Partial<CompactRouteDataTile>;
  return (
    tile.schema === 2 &&
    tile.id === expectedId &&
    Array.isArray(tile.w) &&
    tile.w.length <= ROUTE_RESOURCE_LIMITS.tileWays &&
    tile.w.every(isCompactWay) &&
    Array.isArray(tile.b) &&
    tile.b.length <= ROUTE_RESOURCE_LIMITS.tileBuildings &&
    tile.b.every(isCompactBuilding)
  );
}

function compactTileWork(tile: CompactRouteDataTile): RouteDataWork {
  return {
    ways: tile.w.length,
    buildings: tile.b.length,
    wayPoints: tile.w.reduce<number>((total, value) => {
      const [, , nodes] = value as readonly [
        unknown,
        unknown,
        readonly unknown[],
      ];
      return total + nodes.length;
    }, 0),
    buildingPoints: tile.b.reduce<number>((total, value) => {
      const [, , , coordinates] = value as readonly [
        unknown,
        unknown,
        unknown,
        readonly unknown[],
      ];
      return total + coordinates.length / 2;
    }, 0),
  };
}

function addRouteDataWork(
  total: RouteDataWork,
  current: RouteDataWork,
): RouteDataWork {
  return {
    ways: total.ways + current.ways,
    buildings: total.buildings + current.buildings,
    wayPoints: total.wayPoints + current.wayPoints,
    buildingPoints: total.buildingPoints + current.buildingPoints,
  };
}

function expandCoordinates(coordinates: readonly number[]) {
  return Array.from({ length: coordinates.length / 2 }, (_, index) => ({
    lat: coordinates[index * 2] / MICRO_DEGREES,
    lon: coordinates[index * 2 + 1] / MICRO_DEGREES,
  }));
}

function expandCompactTile(
  tile: CompactRouteDataTile,
  excludedWayIds: ReadonlySet<number>,
  fallbackWayIds: ReadonlySet<number>,
): RouteDataTile {
  const ways = tile.w.flatMap((value) => {
    const [id, flags, nodes, coordinates] = value as [
      number,
      number,
      number[],
      number[],
    ];
    if (excludedWayIds.has(id)) return [];
    const effectiveFlags = fallbackWayIds.has(id) ? flags | 4 : flags;
    return [
      {
        type: "way",
        id,
        tags: {
          highway: effectiveFlags & 2 ? "steps" : "footway",
          ...(effectiveFlags & 1 ? { covered: "yes" } : {}),
          ...(effectiveFlags & 4 ? { "shade-route:fallback": "yes" } : {}),
        },
        nodes: [...nodes],
        geometry: expandCoordinates(coordinates),
      },
    ];
  });
  const buildings = tile.b.map((value) => {
    const [id, height, levels, coordinates] = value as [
      number,
      number | null,
      number | null,
      number[],
    ];
    return {
      type: "way",
      id,
      tags: {
        building: "yes",
        ...(height === null ? {} : { height: String(height) }),
        ...(levels === null ? {} : { "building:levels": String(levels) }),
      },
      geometry: expandCoordinates(coordinates),
    };
  });
  return {
    schema: 1,
    id: tile.id,
    ways: { elements: ways },
    buildings: { elements: buildings },
  };
}

function decodeRouteDataTile(
  value: unknown,
  expectedId: string,
): CompactRouteDataTile | null {
  if (!isCompactRouteDataTile(value, expectedId)) return null;
  assertTileDataBudget(compactTileWork(value));
  return value;
}

function intersects(a: GeoBounds, b: GeoBounds) {
  return !(
    a.east < b.west ||
    a.west > b.east ||
    a.north < b.south ||
    a.south > b.north
  );
}

export function selectManifestTiles(
  manifest: TileManifest,
  start: LatLng,
  goal: LatLng,
  bufferDegrees = DEFAULT_BUFFER_DEGREES,
) {
  const routeBounds: GeoBounds = {
    south: Math.min(start.lat, goal.lat) - bufferDegrees,
    west: Math.min(start.lon, goal.lon) - bufferDegrees,
    north: Math.max(start.lat, goal.lat) + bufferDegrees,
    east: Math.max(start.lon, goal.lon) + bufferDegrees,
  };
  return manifest.tiles.filter((tile) => intersects(tile.bounds, routeBounds));
}

async function loadInBatches<T, Result>(
  items: readonly T[],
  mapper: (item: T) => Promise<Result>,
  startIndex = 0,
): Promise<readonly Result[]> {
  const batch = items.slice(startIndex, startIndex + TILE_FETCH_CONCURRENCY);
  const current = await Promise.all(batch.map(mapper));
  const nextIndex = startIndex + TILE_FETCH_CONCURRENCY;
  return nextIndex >= items.length
    ? current
    : [...current, ...(await loadInBatches(items, mapper, nextIndex))];
}

function mergeElements(groups: readonly OverpassData[]) {
  const elements = new Map<string, OverpassElement>();
  for (const group of groups) {
    for (const element of group.elements) {
      const key = `${element.type}:${element.id}`;
      if (!elements.has(key)) elements.set(key, element);
    }
  }
  return { elements: [...elements.values()] } satisfies OverpassData;
}

export async function loadTiledRouteData(
  start: LatLng,
  goal: LatLng,
  fetcher: typeof fetch = fetch,
  baseUrl = import.meta.env.BASE_URL,
  bufferDegrees = DEFAULT_BUFFER_DEGREES,
  integrity: SeoulArtifactIntegrity = SEOUL_ARTIFACT_INTEGRITY,
): Promise<CorridorData> {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const manifestValue = await fetchJsonWithLimit({
    fetcher,
    url: `${base}${DATA_DIRECTORY}/manifest.json`,
    maxBytes: MAX_MANIFEST_BYTES,
    loadError: "TILE_LOAD_FAILED",
    invalidError: "INVALID_TILE_MANIFEST",
    expectedSha256: integrity.manifestSha256,
    integrityError: "ROUTE_ARTIFACT_MISMATCH",
  });
  if (!isTileManifest(manifestValue)) throw new Error("INVALID_TILE_MANIFEST");
  if (
    manifestValue.releaseId !== integrity.releaseId ||
    manifestValue.artifacts.places.sha256 !== integrity.placesSha256
  ) {
    throw new Error("ROUTE_ARTIFACT_MISMATCH");
  }

  const selected = selectManifestTiles(
    manifestValue,
    start,
    goal,
    bufferDegrees,
  );
  if (selected.length === 0) throw new Error("AREA_DATA_UNAVAILABLE");
  if (selected.length > MAX_ROUTE_TILES) throw new Error("ROUTE_TOO_LARGE");
  const declaredTotal = selected.reduce((total, tile) => total + tile.bytes, 0);
  if (declaredTotal > MAX_ROUTE_BYTES) throw new Error("ROUTE_TOO_LARGE");

  let actualTotalBytes = 0;
  const batchController = new AbortController();
  let compactTiles: readonly CompactRouteDataTile[];
  try {
    compactTiles = await loadInBatches(selected, async (entry) => {
      const value = await fetchJsonWithLimit({
        fetcher,
        url: `${base}${DATA_DIRECTORY}/tiles/${entry.id}.json`,
        maxBytes: MAX_TILE_BYTES,
        loadError: "TILE_LOAD_FAILED",
        invalidError: "INVALID_TILE_DATA",
        expectedSha256: entry.sha256,
        integrityError: "ROUTE_ARTIFACT_MISMATCH",
        signal: batchController.signal,
        abortError: "TILE_LOAD_FAILED",
        onBytes: (bytes) => {
          actualTotalBytes += bytes;
          if (actualTotalBytes > MAX_ROUTE_BYTES) {
            throw new Error("ROUTE_TOO_LARGE");
          }
        },
      });
      const tile = decodeRouteDataTile(value, entry.id);
      if (!tile) {
        throw new Error("INVALID_TILE_DATA");
      }
      return tile;
    });
  } catch (error) {
    batchController.abort();
    throw error;
  }

  const routeWork = compactTiles.map(compactTileWork).reduce(addRouteDataWork, {
    ways: 0,
    buildings: 0,
    wayPoints: 0,
    buildingPoints: 0,
  });
  assertRouteDataBudget(routeWork);
  const walkingPolicy = {
    excludedWayIds: new Set(manifestValue.walkingPolicy.excludedWayIds),
    blockedNodeIds: new Set(manifestValue.walkingPolicy.blockedNodeIds),
    fallbackWayIds: new Set(manifestValue.walkingPolicy.fallbackWayIds),
    wayDirections: new Map(
      manifestValue.walkingPolicy.directions.map(
        ([id, direction]) =>
          [id, direction === 1 ? "forward" : "backward"] as const,
      ),
    ),
  } as const;
  const tiles = compactTiles.map((tile) =>
    expandCompactTile(
      tile,
      walkingPolicy.excludedWayIds,
      walkingPolicy.fallbackWayIds,
    ),
  );

  return {
    ways: mergeElements(tiles.map((tile) => tile.ways)),
    buildings: mergeElements(tiles.map((tile) => tile.buildings)),
    walkingPolicy,
  };
}
