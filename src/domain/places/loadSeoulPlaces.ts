import { fetchJsonWithLimit } from "../data/fetchJson";
import { SEOUL_ARTIFACT_INTEGRITY } from "../../data/seoulArtifactIntegrity.mjs";
import { isWithinSeoul } from "../location/serviceArea";
import type { Place, PlaceKind } from "../routing/types";
import { preparePlaceSearch } from "./searchPlaces";

const MAX_PLACE_BYTES = 12_000_000;
const MAX_PLACES = 50_000;
const MAX_TEXT_LENGTH = 120;
const PLACE_ID = /^osm-(?:node|way)-\d+$/;
const PLACE_KINDS = new Set<PlaceKind>([
  "station",
  "cafe",
  "food",
  "medical",
  "education",
  "store",
  "office",
  "park",
  "landmark",
  "building",
  "address",
]);

interface SourcePlace extends Place {
  readonly aliases: readonly string[];
  readonly kind: PlaceKind;
}

function isWithinCompiledSeoul(latitude: number, longitude: number) {
  if (isWithinSeoul(latitude, longitude)) return true;
  // The compiler uses the full-precision public boundary while the runtime
  // boundary is rounded for bundle size. Keep border POIs within about 100 m.
  const tolerance = 0.001;
  return [-tolerance, 0, tolerance].some((latitudeOffset) =>
    [-tolerance, 0, tolerance].some((longitudeOffset) =>
      isWithinSeoul(latitude + latitudeOffset, longitude + longitudeOffset),
    ),
  );
}

function isSourcePlace(value: unknown): value is SourcePlace {
  if (typeof value !== "object" || value === null) return false;
  const place = value as Partial<SourcePlace>;
  return (
    typeof place.id === "string" &&
    PLACE_ID.test(place.id) &&
    typeof place.name === "string" &&
    place.name.trim().length > 0 &&
    place.name.length <= MAX_TEXT_LENGTH &&
    Array.isArray(place.aliases) &&
    place.aliases.length <= 10 &&
    place.aliases.every(
      (alias) => typeof alias === "string" && alias.length <= MAX_TEXT_LENGTH,
    ) &&
    typeof place.kind === "string" &&
    PLACE_KINDS.has(place.kind as PlaceKind) &&
    (place.address === undefined ||
      (typeof place.address === "string" &&
        place.address.trim().length > 0 &&
        place.address.length <= MAX_TEXT_LENGTH)) &&
    typeof place.lat === "number" &&
    typeof place.lon === "number" &&
    isWithinCompiledSeoul(place.lat, place.lon)
  );
}

function parsePlaceData(value: unknown): readonly Place[] {
  if (typeof value !== "object" || value === null) {
    throw new Error("INVALID_PLACE_DATA");
  }
  const data = value as { schema?: unknown; places?: unknown };
  if (
    data.schema !== 2 ||
    !Array.isArray(data.places) ||
    data.places.length > MAX_PLACES ||
    !data.places.every(isSourcePlace)
  ) {
    throw new Error("INVALID_PLACE_DATA");
  }

  const destinations = new Map<string, Place>();
  for (const place of data.places) {
    if (place.kind === "station" && !/[^\d\s.-]/u.test(place.name)) continue;
    if (destinations.has(place.id)) continue;
    destinations.set(place.id, {
      id: place.id,
      name: place.name.trim(),
      aliases: place.aliases.map((alias) => alias.trim()).filter(Boolean),
      address: place.address?.trim(),
      kind: place.kind,
      lat: place.lat,
      lon: place.lon,
    });
  }
  const result = [...destinations.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name, "ko") || a.id.localeCompare(b.id),
  );
  preparePlaceSearch(result);
  return result;
}

export async function loadSeoulPlaces(
  fetcher: typeof fetch = fetch,
  baseUrl = import.meta.env.BASE_URL,
  expectedSha256 = SEOUL_ARTIFACT_INTEGRITY.placesSha256,
): Promise<readonly Place[]> {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  try {
    return parsePlaceData(
      await fetchJsonWithLimit({
        fetcher,
        url: `${base}data/seoul/places.json`,
        maxBytes: MAX_PLACE_BYTES,
        loadError: "PLACE_LOAD_FAILED",
        invalidError: "INVALID_PLACE_DATA",
        expectedSha256,
        integrityError: "PLACE_ARTIFACT_MISMATCH",
      }),
    );
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "INVALID_PLACE_DATA" ||
        error.message === "PLACE_LOAD_FAILED" ||
        error.message === "PLACE_ARTIFACT_MISMATCH")
    ) {
      throw error;
    }
    throw new Error("INVALID_PLACE_DATA");
  }
}
