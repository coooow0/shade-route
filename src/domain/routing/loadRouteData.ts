import type { CorridorData, OverpassData } from "./types";

let cachedData: Promise<CorridorData> | null = null;

const MAX_RESPONSE_BYTES = 5_000_000;
const MAX_ELEMENTS = 10_000;
const MAX_GEOMETRY_POINTS = 1_000;
const MAX_TAGS = 100;
const MAX_TAG_LENGTH = 500;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidElement(value: unknown) {
  if (typeof value !== "object" || value === null) return false;
  const element = value as {
    type?: unknown;
    id?: unknown;
    nodes?: unknown;
    geometry?: unknown;
    tags?: unknown;
  };
  if (typeof element.type !== "string" || !isFiniteNumber(element.id)) {
    return false;
  }
  if (
    element.nodes !== undefined &&
    (!Array.isArray(element.nodes) ||
      element.nodes.length > MAX_GEOMETRY_POINTS ||
      !element.nodes.every(isFiniteNumber))
  ) {
    return false;
  }
  if (element.tags !== undefined) {
    if (
      typeof element.tags !== "object" ||
      element.tags === null ||
      Array.isArray(element.tags)
    ) {
      return false;
    }
    const tags = Object.entries(element.tags);
    if (
      tags.length > MAX_TAGS ||
      !tags.every(
        ([key, tagValue]) =>
          key.length <= MAX_TAG_LENGTH &&
          typeof tagValue === "string" &&
          tagValue.length <= MAX_TAG_LENGTH,
      )
    ) {
      return false;
    }
  }
  if (element.geometry === undefined) return true;
  if (
    !Array.isArray(element.geometry) ||
    element.geometry.length > MAX_GEOMETRY_POINTS
  ) {
    return false;
  }
  return element.geometry.every((point: unknown) => {
    if (typeof point !== "object" || point === null) return false;
    const { lat, lon } = point as { lat?: unknown; lon?: unknown };
    return (
      isFiniteNumber(lat) &&
      isFiniteNumber(lon) &&
      lat >= -90 &&
      lat <= 90 &&
      lon >= -180 &&
      lon <= 180
    );
  });
}

export function isOverpassData(value: unknown): value is OverpassData {
  if (typeof value !== "object" || value === null || !("elements" in value)) {
    return false;
  }
  const elements = (value as { elements?: unknown }).elements;
  return (
    Array.isArray(elements) &&
    elements.length <= MAX_ELEMENTS &&
    elements.every(isValidElement)
  );
}

async function fetchJson(
  fetcher: typeof fetch,
  url: string,
): Promise<OverpassData> {
  let response: Response;
  try {
    response = await fetcher(url);
  } catch {
    throw new Error("LOAD_FAILED");
  }
  if (!response.ok) throw new Error("LOAD_FAILED");
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new Error("INVALID_DATA");
  }
  let body: string;
  try {
    body = await response.text();
  } catch {
    throw new Error("LOAD_FAILED");
  }
  if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
    throw new Error("INVALID_DATA");
  }
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error("INVALID_DATA");
  }
  if (!isOverpassData(data)) throw new Error("INVALID_DATA");
  return data;
}

export async function loadRouteData(
  fetcher: typeof fetch = fetch,
): Promise<CorridorData> {
  const load = async () => {
    const base = import.meta.env.BASE_URL;
    const [ways, buildings] = await Promise.all([
      fetchJson(fetcher, `${base}data/ways.json`),
      fetchJson(fetcher, `${base}data/buildings.json`),
    ]);
    return { ways, buildings };
  };
  if (fetcher !== fetch) return load();
  cachedData ??= load().catch((error: unknown) => {
    cachedData = null;
    throw error;
  });
  return cachedData;
}
