import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const ZOOM = 15;
const MAX_ELEMENT_TILES = 32;
const root = resolve(import.meta.dirname, "..");
const waysPath = resolve(root, process.argv[2] ?? "public/data/ways.json");
const buildingsPath = resolve(
  root,
  process.argv[3] ?? "public/data/buildings.json",
);
const outputDirectory = resolve(root, process.argv[4] ?? "public/data/tiles");

function lonToX(lon) {
  return Math.floor(((lon + 180) / 360) * 2 ** ZOOM);
}

function latToY(lat) {
  const radians = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * 2 ** ZOOM,
  );
}

function tileBounds(x, y) {
  const size = 2 ** ZOOM;
  const west = (x / size) * 360 - 180;
  const east = ((x + 1) / size) * 360 - 180;
  const north =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / size))) * 180) / Math.PI;
  const south =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / size))) * 180) /
    Math.PI;
  return { south, west, north, east };
}

function tileId(x, y) {
  return `${ZOOM}-${x}-${y}`;
}

function elementTiles(element) {
  const geometry = element.geometry ?? [];
  if (geometry.length === 0) return [];
  const xs = geometry.map((point) => lonToX(point.lon));
  const ys = geometry.map((point) => latToY(point.lat));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const count = (maxX - minX + 1) * (maxY - minY + 1);
  if (count > MAX_ELEMENT_TILES) {
    throw new Error(`Element ${element.id} crosses ${count} tiles`);
  }
  const result = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) result.push({ x, y });
  }
  return result;
}

function buildingOwnerTile(element) {
  const geometry = element.geometry ?? [];
  if (geometry.length === 0) return null;
  const center = geometry.reduce(
    (total, point) => ({
      lat: total.lat + point.lat,
      lon: total.lon + point.lon,
    }),
    { lat: 0, lon: 0 },
  );
  return {
    x: lonToX(center.lon / geometry.length),
    y: latToY(center.lat / geometry.length),
  };
}

function getTile(tiles, x, y) {
  const id = tileId(x, y);
  const existing = tiles.get(id);
  if (existing) return existing;
  const created = {
    id,
    x,
    y,
    ways: new Map(),
    buildings: new Map(),
  };
  tiles.set(id, created);
  return created;
}

function allGeometry(elements) {
  return elements.flatMap((element) => element.geometry ?? []);
}

const ways = JSON.parse(await readFile(waysPath, "utf8"));
const buildings = JSON.parse(await readFile(buildingsPath, "utf8"));
const tiles = new Map();

for (const element of ways.elements ?? []) {
  for (const { x, y } of elementTiles(element)) {
    getTile(tiles, x, y).ways.set(element.id, element);
  }
}

for (const element of buildings.elements ?? []) {
  const owner = buildingOwnerTile(element);
  if (owner)
    getTile(tiles, owner.x, owner.y).buildings.set(element.id, element);
}

await mkdir(outputDirectory, { recursive: true });
const manifestTiles = [];
for (const tile of [...tiles.values()].sort((a, b) =>
  a.id.localeCompare(b.id),
)) {
  const payload = JSON.stringify({
    schema: 1,
    id: tile.id,
    ways: { elements: [...tile.ways.values()] },
    buildings: { elements: [...tile.buildings.values()] },
  });
  const filePath = join(outputDirectory, `${tile.id}.json`);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, payload);
  manifestTiles.push({
    id: tile.id,
    bounds: tileBounds(tile.x, tile.y),
    bytes: Buffer.byteLength(payload),
  });
}

const geometry = allGeometry([
  ...(ways.elements ?? []),
  ...(buildings.elements ?? []),
]);
if (geometry.length === 0) throw new Error("No geometry found");
const manifest = {
  schema: 1,
  zoom: ZOOM,
  coverage: {
    south: Math.min(...geometry.map((point) => point.lat)),
    west: Math.min(...geometry.map((point) => point.lon)),
    north: Math.max(...geometry.map((point) => point.lat)),
    east: Math.max(...geometry.map((point) => point.lon)),
  },
  tiles: manifestTiles,
};
await writeFile(
  join(outputDirectory, "manifest.json"),
  `${JSON.stringify(manifest)}\n`,
);

const totalBytes = manifestTiles.reduce((total, tile) => total + tile.bytes, 0);
console.log(
  JSON.stringify({
    tiles: manifestTiles.length,
    ways: ways.elements?.length ?? 0,
    buildings: buildings.elements?.length ?? 0,
    totalBytes,
  }),
);
