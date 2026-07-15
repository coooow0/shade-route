import { describe, expect, it } from "vitest";
import { SEOUL_BOUNDARY, type BoundaryRing } from "../../data/seoulBoundary";
import { isWithinSeoul } from "./serviceArea";

function referencePointInRing(
  longitude: number,
  latitude: number,
  ring: BoundaryRing,
) {
  let inside = false;
  for (
    let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index++
  ) {
    const [currentLongitude, currentLatitude] = ring[index];
    const [previousLongitude, previousLatitude] = ring[previous];
    if (
      currentLatitude > latitude !== previousLatitude > latitude &&
      longitude <
        ((previousLongitude - currentLongitude) *
          (latitude - currentLatitude)) /
          (previousLatitude - currentLatitude) +
          currentLongitude
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function referenceIsWithinSeoul(latitude: number, longitude: number) {
  return SEOUL_BOUNDARY.some(
    ([outer, ...holes]) =>
      referencePointInRing(longitude, latitude, outer) &&
      holes.every((hole) => !referencePointInRing(longitude, latitude, hole)),
  );
}

describe("Seoul service area", () => {
  it.each([
    ["시청", 37.5665, 126.978],
    ["강남", 37.4995, 127.0284],
    ["홍대", 37.5572, 126.9245],
    ["잠실", 37.5133, 127.1001],
  ])("includes %s", (_name, lat, lon) => {
    expect(isWithinSeoul(lat, lon)).toBe(true);
  });

  it.each([
    ["인천", 37.4563, 126.7052],
    ["성남", 37.4201, 127.1265],
    ["고양시청", 37.6584, 126.832],
    ["광명시청", 37.4786, 126.8644],
  ])("excludes %s", (_name, lat, lon) => {
    expect(isWithinSeoul(lat, lon)).toBe(false);
  });

  it("rejects invalid coordinates", () => {
    expect(isWithinSeoul(Number.NaN, 127)).toBe(false);
    expect(isWithinSeoul(37.5, Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("matches the full-ring algorithm across the Seoul bounding region", () => {
    const samples = Array.from({ length: 48 * 48 }, (_, index) => {
      const row = Math.floor(index / 48);
      const column = index % 48;
      return {
        lat: 37.42 + (row / 47) * 0.3,
        lon: 126.74 + (column / 47) * 0.47,
      };
    });

    for (const { lat, lon } of samples) {
      expect(isWithinSeoul(lat, lon)).toBe(referenceIsWithinSeoul(lat, lon));
    }
  });
});
