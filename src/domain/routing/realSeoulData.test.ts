import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSeoulPlaces } from "../places/loadSeoulPlaces";
import { searchPlaces } from "../places/searchPlaces";
import { buildWalkingDirections } from "./directions";
import { calculateFromData } from "./routeService";
import { loadTiledRouteData } from "./tileRouteData";
import type { Place } from "./types";

const fetchPublicFile: typeof fetch = async (input) => {
  const path = String(input).replace(/^\//, "");
  try {
    return new Response(await readFile(resolve(process.cwd(), "public", path)));
  } catch {
    return new Response(null, { status: 404 });
  }
};

const ROUTES: readonly [Place, Place][] = [
  [
    { id: "city-hall", name: "시청", lat: 37.5665, lon: 126.978 },
    { id: "jonggak", name: "종각", lat: 37.5702, lon: 126.9831 },
  ],
  [
    { id: "hongdae", name: "홍대입구", lat: 37.5572, lon: 126.9245 },
    { id: "hapjeong", name: "합정", lat: 37.5495, lon: 126.9137 },
  ],
  [
    { id: "jamsil", name: "잠실", lat: 37.5133, lon: 127.1001 },
    { id: "seokchon", name: "석촌", lat: 37.5054, lon: 127.1069 },
  ],
  [
    {
      id: "guro-digital",
      name: "구로디지털단지",
      lat: 37.4852761,
      lon: 126.9015916,
    },
    { id: "sindaebang", name: "신대방", lat: 37.4875949, lon: 126.9133919 },
  ],
  [
    { id: "gimpo-airport", name: "김포공항", lat: 37.5619247, lon: 126.8013934 },
    { id: "airport-market", name: "공항시장", lat: 37.5636577, lon: 126.8106016 },
  ],
  [
    { id: "seoul-station", name: "서울역", lat: 37.5528527, lon: 126.9725721 },
    { id: "hoehyeon", name: "회현", lat: 37.5586981, lon: 126.9784167 },
  ],
  [
    { id: "maebong", name: "매봉", lat: 37.4870692, lon: 127.046978 },
    { id: "dogok", name: "도곡", lat: 37.4909056, lon: 127.0554679 },
  ],
  [
    { id: "achasan", name: "아차산", lat: 37.5516981, lon: 127.0897955 },
    {
      id: "children-grand-park",
      name: "어린이대공원",
      lat: 37.5475998,
      lon: 127.0743915,
    },
  ],
];

describe("compiled Seoul route data", () => {
  it("loads and searches the validated Seoul destination index", async () => {
    const places = await loadSeoulPlaces(fetchPublicFile, "/");

    expect(places.length).toBeGreaterThan(40_000);
    expect(places.some((place) => place.name === "시청")).toBe(true);
    expect(places.some((place) => place.name === "강남")).toBe(true);
    expect(searchPlaces(places, "삼성서울병원")[0]).toMatchObject({
      name: "삼성서울병원",
      kind: "medical",
    });
    expect(searchPlaces(places, "일원로 81")[0]).toMatchObject({
      name: "삼성서울병원",
    });
  });

  it.each(ROUTES)(
    "calculates a continuous %s to %s route across Seoul tiles",
    async (start, goal) => {
      const data = await loadTiledRouteData(
        start,
        goal,
        fetchPublicFile,
        "/",
      );
      const bundle = calculateFromData({
        data,
        start,
        goal,
        at: new Date("2026-08-05T14:00:00+09:00"),
      });

      expect(bundle.routes).toHaveLength(3);
      expect(bundle.routes[0].lengthM).toBeGreaterThan(100);
      expect(bundle.routes.every((route) => route.lengthM <= 3_000)).toBe(true);
      expect(bundle.routes[0].segments.length).toBeGreaterThan(1);
      const directions = buildWalkingDirections(
        bundle.routes[1].segments,
        goal.name,
      );
      expect(directions.length).toBeGreaterThanOrEqual(2);
      expect(directions.length).toBeLessThanOrEqual(20);
    },
    20_000,
  );

  it("keeps the Gangnam to Yeoksam preview free of connector turns and false U-turns", async () => {
    const start: Place = {
      id: "gangnam-11",
      name: "강남역 11번 출구",
      lat: 37.4995,
      lon: 127.0284,
    };
    const goal: Place = {
      id: "yeoksam",
      name: "역삼역",
      lat: 37.5007,
      lon: 127.0364,
    };
    const data = await loadTiledRouteData(start, goal, fetchPublicFile, "/");
    const bundle = calculateFromData({
      data,
      start,
      goal,
      at: new Date("2026-07-12T03:00:00+09:00"),
    });
    const directions = buildWalkingDirections(bundle.routes[1].segments, goal.name);

    expect(directions[0].kind).toBe("connector");
    expect(directions[1].kind).toBe("depart");
    expect(
      directions.some(
        (direction) =>
          direction.kind === "uturn-left" || direction.kind === "uturn-right",
      ),
    ).toBe(false);
  });
});
