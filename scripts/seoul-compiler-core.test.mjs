import { describe, expect, it } from "vitest";
import {
  coordinateToTile,
  formatPlaceAddress,
  isFallbackRoad,
  limitPlacesByKind,
  placeKindFromTags,
  isWalkableTags,
  normalizePlaceName,
  pointInMultiPolygon,
  tileBounds,
} from "./seoul-compiler-core.mjs";

describe("Seoul compiler core", () => {
  it("includes pedestrian ways and excludes unsafe private roads", () => {
    expect(isWalkableTags({ highway: "footway" })).toBe(true);
    expect(isWalkableTags({ highway: "primary", sidewalk: "yes" })).toBe(true);
    expect(isWalkableTags({ highway: "secondary" })).toBe(true);
    expect(isFallbackRoad({ highway: "secondary" })).toBe(true);
    expect(
      isFallbackRoad({ highway: "secondary", sidewalk: "yes" }),
    ).toBe(false);
    expect(isWalkableTags({ highway: "secondary", sidewalk: "no" })).toBe(
      false,
    );
    expect(isWalkableTags({ highway: "unclassified" })).toBe(true);
    expect(isWalkableTags({ highway: "motorway" })).toBe(false);
    expect(isWalkableTags({ highway: "secondary", foot: "no" })).toBe(false);
    expect(isWalkableTags({ highway: "service", access: "private" })).toBe(
      false,
    );
  });

  it("handles polygon holes", () => {
    const polygon = [
      [
        [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
          [0, 0],
        ],
        [
          [1, 1],
          [2, 1],
          [2, 2],
          [1, 2],
          [1, 1],
        ],
      ],
    ];

    expect(pointInMultiPolygon([3, 3], polygon)).toBe(true);
    expect(pointInMultiPolygon([1.5, 1.5], polygon)).toBe(false);
    expect(pointInMultiPolygon([5, 5], polygon)).toBe(false);
  });

  it("round-trips a coordinate into containing tile bounds", () => {
    const point = { lat: 37.4995, lon: 127.0284 };
    const tile = coordinateToTile(point.lat, point.lon);
    const bounds = tileBounds(tile.x, tile.y);

    expect(point.lat).toBeGreaterThanOrEqual(bounds.south);
    expect(point.lat).toBeLessThanOrEqual(bounds.north);
    expect(point.lon).toBeGreaterThanOrEqual(bounds.west);
    expect(point.lon).toBeLessThanOrEqual(bounds.east);
  });

  it("normalizes Korean place names for local search", () => {
    expect(normalizePlaceName("  강남 역 ")).toBe("강남역");
  });

  it("classifies useful walking destinations and rejects unnamed map noise", () => {
    expect(placeKindFromTags({ amenity: "cafe", name: "테스트 카페" })).toBe(
      "cafe",
    );
    expect(placeKindFromTags({ healthcare: "hospital", name: "테스트 병원" })).toBe(
      "medical",
    );
    expect(placeKindFromTags({ shop: "convenience", name: "테스트 상점" })).toBe(
      "store",
    );
    expect(placeKindFromTags({ building: "yes", name: "테스트 타워" })).toBe(
      "building",
    );
    expect(placeKindFromTags({ building: "yes" })).toBe(null);
  });

  it("builds a searchable Korean road address", () => {
    expect(
      formatPlaceAddress({
        "addr:city": "서울특별시",
        "addr:street": "테헤란로",
        "addr:housenumber": "142",
      }),
    ).toBe("서울특별시 테헤란로 142");
    expect(formatPlaceAddress({ "addr:full": "서울 강남구 테헤란로 142" })).toBe(
      "서울 강남구 테헤란로 142",
    );
  });

  it("reserves each destination category before filling unused capacity", () => {
    const food = Array.from({ length: 5 }, (_, index) => ({
      id: `food-${index}`,
      name: `음식점 ${index}`,
      kind: "food",
    }));
    const addresses = Array.from({ length: 3 }, (_, index) => ({
      id: `address-${index}`,
      name: `테헤란로 ${index}`,
      kind: "address",
    }));

    const limited = limitPlacesByKind([...food, ...addresses], {
      limits: { food: 2, address: 3 },
      maximum: 6,
    });

    expect(limited.filter(({ kind }) => kind === "address")).toHaveLength(3);
    expect(limited).toHaveLength(6);
  });
});
