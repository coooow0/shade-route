import type { Building, OverpassData } from "./types";
import type { Projection } from "./geo";

export interface BuildingStats {
  readonly total: number;
  readonly missing: number;
  readonly missingRate: number;
  readonly fallbackHeight: number;
}

export function parseBuildings(data: OverpassData, projection: Projection) {
  const fallbackHeight = 12;
  const parsed: Array<
    Omit<Building, "height"> & { readonly height: number | null }
  > = [];
  let missing = 0;

  for (const element of data.elements) {
    if (element.type !== "way" || !element.geometry || !element.tags?.building)
      continue;
    const poly = element.geometry.map(({ lat, lon }) =>
      projection.toXY(lat, lon),
    );
    if (poly.length < 3) continue;
    const heightTag = element.tags.height ?? element.tags["building:height"];
    const parsedHeight = heightTag
      ? Number.parseFloat(heightTag.replace(/m$/i, "").trim())
      : Number.NaN;
    const levels = Number.parseFloat(element.tags["building:levels"] ?? "");
    const height =
      Number.isFinite(parsedHeight) && parsedHeight > 0
        ? parsedHeight
        : Number.isFinite(levels) && levels > 0
          ? levels * 3.3
          : null;
    if (height === null) missing++;
    parsed.push({
      id: element.id,
      poly,
      height,
      estimated:
        height === null || !(Number.isFinite(parsedHeight) && parsedHeight > 0),
    });
  }

  const buildings: readonly Building[] = parsed.map((building) => ({
    ...building,
    height: building.height ?? fallbackHeight,
  }));
  const stats: BuildingStats = {
    total: buildings.length,
    missing,
    missingRate: buildings.length === 0 ? 0 : missing / buildings.length,
    fallbackHeight,
  };
  return { buildings, stats };
}
