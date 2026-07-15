import { fetchJsonWithLimit } from "../data/fetchJson";
import {
  assertRouteDataBudget,
  assertTileDataBudget,
  ROUTE_RESOURCE_LIMITS,
  type RouteDataWork,
} from "./resourceLimits";
import type {
  CorridorData,
  LatLng,
  OverpassData,
  OverpassElement,
} from "./types";

const TILE_ID = /^\d{1,2}-\d{1,8}-\d{1,8}$/;
const MAX_MANIFEST_BYTES = 1_000_000;
const MAX_TILE_BYTES = 2_000_000;
const MAX_ROUTE_BYTES = 12_000_000;
const MAX_MANIFEST_TILES = 2_000;
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
}

export interface TileManifest {
  readonly schema: 1;
  readonly zoom: number;
  readonly coverage: GeoBounds;
  readonly tiles: readonly TileManifestEntry[];
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

function isBounds(value: unknown): value is GeoBounds {
  if (typeof value !== "object" || value === null) return false;
  const bounds = value as Partial<GeoBounds>;
  return (
    isFiniteNumber(bounds.south) &&
    isFiniteNumber(bounds.west) &&
    isFiniteNumber(bounds.north) &&
    isFiniteNumber(bounds.east) &&
    bounds.south >= -90 &&
    bounds.north <= 90 &&
    bounds.west >= -180 &&
    bounds.east <= 180 &&
    bounds.south < bounds.north &&
    bounds.west < bounds.east
  );
}

function isTileManifest(value: unknown): value is TileManifest {
  if (typeof value !== "object" || value === null) return false;
  const manifest = value as Partial<TileManifest>;
  return (
    manifest.schema === 1 &&
    Number.isInteger(manifest.zoom) &&
    (manifest.zoom ?? 0) >= 0 &&
    (manifest.zoom ?? 0) <= 22 &&
    isBounds(manifest.coverage) &&
    Array.isArray(manifest.tiles) &&
    manifest.tiles.length <= MAX_MANIFEST_TILES &&
    manifest.tiles.every(
      (tile) =>
        typeof tile === "object" &&
        tile !== null &&
        TILE_ID.test(tile.id) &&
        isBounds(tile.bounds) &&
        Number.isInteger(tile.bytes) &&
        tile.bytes > 0 &&
        tile.bytes <= MAX_TILE_BYTES,
    )
  );
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

function expandCompactTile(tile: CompactRouteDataTile): RouteDataTile {
  const ways = tile.w.map((value) => {
    const [id, flags, nodes, coordinates] = value as [
      number,
      number,
      number[],
      number[],
    ];
    return {
      type: "way",
      id,
      tags: {
        highway: flags & 2 ? "steps" : "footway",
        ...(flags & 1 ? { covered: "yes" } : {}),
        ...(flags & 4 ? { "shade-route:fallback": "yes" } : {}),
      },
      nodes: [...nodes],
      geometry: expandCoordinates(coordinates),
    };
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
): Promise<CorridorData> {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const manifestValue = await fetchJsonWithLimit({
    fetcher,
    url: `${base}${DATA_DIRECTORY}/manifest.json`,
    maxBytes: MAX_MANIFEST_BYTES,
    loadError: "TILE_LOAD_FAILED",
    invalidError: "INVALID_TILE_MANIFEST",
  });
  if (!isTileManifest(manifestValue)) throw new Error("INVALID_TILE_MANIFEST");

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

  const compactTiles = await loadInBatches(selected, async (entry) => {
    const value = await fetchJsonWithLimit({
      fetcher,
      url: `${base}${DATA_DIRECTORY}/tiles/${entry.id}.json`,
      maxBytes: Math.min(entry.bytes + 1_024, MAX_TILE_BYTES),
      loadError: "TILE_LOAD_FAILED",
      invalidError: "INVALID_TILE_DATA",
    });
    const tile = decodeRouteDataTile(value, entry.id);
    if (!tile) {
      throw new Error("INVALID_TILE_DATA");
    }
    return tile;
  });

  const routeWork = compactTiles.map(compactTileWork).reduce(addRouteDataWork, {
    ways: 0,
    buildings: 0,
    wayPoints: 0,
    buildingPoints: 0,
  });
  assertRouteDataBudget(routeWork);
  const tiles = compactTiles.map(expandCompactTile);

  return {
    ways: mergeElements(tiles.map((tile) => tile.ways)),
    buildings: mergeElements(tiles.map((tile) => tile.buildings)),
  };
}
