import { describe, expect, it } from "vitest";
import { isWithinSeoul } from "./serviceArea";

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
});
