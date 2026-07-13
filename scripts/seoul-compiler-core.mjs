const WALKABLE = new Set([
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

const FOOD_AMENITIES = new Set([
  "bar",
  "fast_food",
  "food_court",
  "ice_cream",
  "pub",
  "restaurant",
]);
const MEDICAL_AMENITIES = new Set([
  "clinic",
  "dentist",
  "doctors",
  "hospital",
  "pharmacy",
]);
const EDUCATION_AMENITIES = new Set([
  "college",
  "kindergarten",
  "language_school",
  "library",
  "school",
  "university",
]);
const TRANSIT_RAILWAYS = new Set(["halt", "station", "subway_entrance"]);

function cleanPlaceText(value) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/gu, " ").trim();
  return cleaned.length > 0 ? cleaned : null;
}

export function formatPlaceAddress(tags = {}) {
  const full = cleanPlaceText(tags["addr:full"]);
  if (full) return full;
  const parts = [
    tags["addr:city"],
    tags["addr:district"],
    tags["addr:street"] ?? tags["addr:place"],
    tags["addr:housenumber"],
  ]
    .map(cleanPlaceText)
    .filter(Boolean);
  return parts.length > 0 ? [...new Set(parts)].join(" ") : null;
}

export function placeKindFromTags(tags = {}) {
  const hasName = Boolean(cleanPlaceText(tags["name:ko"] ?? tags.name));
  const hasAddress = Boolean(formatPlaceAddress(tags));
  if (!hasName && !hasAddress) return null;
  if (
    TRANSIT_RAILWAYS.has(tags.railway) ||
    tags.public_transport === "station"
  ) {
    return "station";
  }
  if (tags.amenity === "cafe") return "cafe";
  if (FOOD_AMENITIES.has(tags.amenity)) return "food";
  if (
    MEDICAL_AMENITIES.has(tags.amenity) ||
    typeof tags.healthcare === "string"
  ) {
    return "medical";
  }
  if (EDUCATION_AMENITIES.has(tags.amenity)) return "education";
  if (typeof tags.shop === "string") return "store";
  if (typeof tags.office === "string") return "office";
  if (tags.leisure === "park" || tags.leisure === "garden") return "park";
  if (
    typeof tags.tourism === "string" ||
    typeof tags.historic === "string" ||
    tags.amenity === "place_of_worship" ||
    tags.amenity === "theatre" ||
    tags.amenity === "cinema"
  ) {
    return "landmark";
  }
  if (typeof tags.building === "string" && hasName) return "building";
  return hasAddress ? "address" : null;
}

export function limitPlacesByKind(places, { limits, maximum }) {
  if (!Number.isInteger(maximum) || maximum <= 0) return [];
  const ordered = [...places].sort(
    (a, b) =>
      a.name.localeCompare(b.name, "ko") || a.id.localeCompare(b.id),
  );
  const counts = new Map();
  const selected = [];
  const overflow = [];
  for (const place of ordered) {
    const limit = Math.max(0, limits[place.kind] ?? maximum);
    const count = counts.get(place.kind) ?? 0;
    if (count < limit) {
      selected.push(place);
      counts.set(place.kind, count + 1);
    } else {
      overflow.push(place);
    }
  }
  return [...selected, ...overflow.slice(0, Math.max(0, maximum - selected.length))]
    .slice(0, maximum)
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, "ko") || a.id.localeCompare(b.id),
    );
}

export function isWalkableTags(tags = {}) {
  const pedestrianSpace =
    tags.foot === "yes" ||
    tags.foot === "designated" ||
    [
      tags.sidewalk,
      tags["sidewalk:left"],
      tags["sidewalk:right"],
      tags["sidewalk:both"],
    ].some(
      (value) =>
        value !== undefined &&
        value !== "no" &&
        value !== "none" &&
        value !== "separate",
    );
  const sidewalkValues = [
    tags.sidewalk,
    tags["sidewalk:left"],
    tags["sidewalk:right"],
    tags["sidewalk:both"],
  ];
  const explicitlyUnsafeRoad =
    CONDITIONAL_ROADS.has(tags.highway ?? "") &&
    !pedestrianSpace &&
    sidewalkValues.some((value) =>
      ["no", "none", "separate"].includes(value),
    );
  const supported =
    WALKABLE.has(tags.highway ?? "") ||
    CONDITIONAL_ROADS.has(tags.highway ?? "");
  if (!supported || tags.foot === "no") return false;
  if (tags.motorroad === "yes") return false;
  if (explicitlyUnsafeRoad) return false;
  return !(
    (tags.access === "private" || tags.access === "no") &&
    tags.foot !== "yes" &&
    tags.foot !== "designated"
  );
}

export function isFallbackRoad(tags = {}) {
  if (!CONDITIONAL_ROADS.has(tags.highway ?? "")) return false;
  return !(
    tags.foot === "yes" ||
    tags.foot === "designated" ||
    [
      tags.sidewalk,
      tags["sidewalk:left"],
      tags["sidewalk:right"],
      tags["sidewalk:both"],
    ].some(
      (value) =>
        value !== undefined &&
        value !== "no" &&
        value !== "none" &&
        value !== "separate",
    )
  );
}

export function pointInRing([lon, lat], ring) {
  let inside = false;
  for (
    let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index++
  ) {
    const [currentLon, currentLat] = ring[index];
    const [previousLon, previousLat] = ring[previous];
    const crosses =
      currentLat > lat !== previousLat > lat &&
      lon <
        ((previousLon - currentLon) * (lat - currentLat)) /
          (previousLat - currentLat) +
          currentLon;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function pointInMultiPolygon(point, coordinates) {
  return coordinates.some((polygon) => {
    const [outer, ...holes] = polygon;
    return (
      pointInRing(point, outer) &&
      !holes.some((hole) => pointInRing(point, hole))
    );
  });
}

export function coordinateToTile(lat, lon, zoom = 15) {
  const size = 2 ** zoom;
  const radians = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lon + 180) / 360) * size),
    y: Math.floor(((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * size),
  };
}

export function tileBounds(x, y, zoom = 15) {
  const size = 2 ** zoom;
  const west = (x / size) * 360 - 180;
  const east = ((x + 1) / size) * 360 - 180;
  const north =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / size))) * 180) / Math.PI;
  const south =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / size))) * 180) /
    Math.PI;
  return { south, west, north, east };
}

export function normalizePlaceName(name) {
  return name.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
}
