import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { calculateFromData, PLACES } from "./routeService";
import { loadTiledRouteData } from "./tileRouteData";

const fetchPublicFile: typeof fetch = async (input) => {
  const path = String(input).replace(/^\//, "");
  try {
    const body = await readFile(resolve(process.cwd(), "public", path));
    return new Response(body);
  } catch {
    return new Response(null, { status: 404 });
  }
};

describe("real tiled Gangnam data", () => {
  it("loads multiple tiles and calculates a continuous route", async () => {
    const data = await loadTiledRouteData(
      PLACES[0],
      PLACES[1],
      fetchPublicFile,
      "/",
    );
    const result = calculateFromData({
      data,
      start: PLACES[0],
      goal: PLACES[1],
      at: new Date("2026-08-05T14:00:00+09:00"),
    });

    expect(data.ways.elements.length).toBeGreaterThan(100);
    expect(data.buildings.elements.length).toBeGreaterThan(100);
    expect(result.routes).toHaveLength(3);
    for (const route of result.routes) {
      expect(route.segments.length).toBeGreaterThan(0);
      for (let index = 1; index < route.segments.length; index++) {
        expect(route.segments[index].from).toEqual(
          route.segments[index - 1].to,
        );
      }
    }
  });
});
