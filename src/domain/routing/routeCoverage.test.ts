import { describe, expect, it } from "vitest";
import { validateRouteLengths, validateSeoulRoute } from "./routeCoverage";

describe("Seoul route coverage", () => {
  it("accepts a local route inside Seoul", () => {
    expect(() =>
      validateSeoulRoute(
        { id: "city-hall", name: "시청", lat: 37.5665, lon: 126.978 },
        { id: "jonggak", name: "종각", lat: 37.5702, lon: 126.9831 },
      ),
    ).not.toThrow();
  });

  it("rejects a route longer than the three-kilometer MVP radius", () => {
    expect(() =>
      validateSeoulRoute(
        { id: "gangnam", name: "강남", lat: 37.4979, lon: 127.0276 },
        { id: "hongdae", name: "홍대입구", lat: 37.5572, lon: 126.9245 },
      ),
    ).toThrow("ROUTE_TOO_LONG");
  });

  it("rejects endpoints outside the exact Seoul boundary", () => {
    expect(() =>
      validateSeoulRoute(
        { id: "city-hall", name: "시청", lat: 37.5665, lon: 126.978 },
        { id: "goyang", name: "고양시청", lat: 37.6584, lon: 126.832 },
      ),
    ).toThrow("OUTSIDE_SEOUL");
  });

  it("rejects any computed route that exceeds three kilometers", () => {
    expect(() => validateRouteLengths([2_800, 3_000])).not.toThrow();
    expect(() => validateRouteLengths([2_800, 3_001])).toThrow(
      "ROUTE_TOO_LONG",
    );
  });
});
