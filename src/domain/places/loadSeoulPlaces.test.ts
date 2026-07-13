import { describe, expect, it, vi } from "vitest";
import { loadSeoulPlaces } from "./loadSeoulPlaces";

function response(value: unknown) {
  return new Response(JSON.stringify(value));
}

describe("loadSeoulPlaces", () => {
  it("loads searchable Seoul destinations with category and address metadata", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        schema: 2,
        places: [
          {
            id: "osm-node-1",
            name: "시청",
            aliases: ["City Hall"],
            kind: "station",
            lat: 37.5657,
            lon: 126.9769,
          },
          {
            id: "osm-way-2",
            name: "토스플레이스",
            aliases: ["Toss Place"],
            address: "서울 강남구 테헤란로 142",
            kind: "office",
            lat: 37.5007,
            lon: 127.0364,
          },
        ],
      }),
    );

    await expect(loadSeoulPlaces(fetcher, "/")).resolves.toEqual([
      {
        id: "osm-node-1",
        name: "시청",
        aliases: ["City Hall"],
        kind: "station",
        lat: 37.5657,
        lon: 126.9769,
      },
      {
        id: "osm-way-2",
        name: "토스플레이스",
        aliases: ["Toss Place"],
        address: "서울 강남구 테헤란로 142",
        kind: "office",
        lat: 37.5007,
        lon: 127.0364,
      },
    ]);
  });

  it("rejects a place outside the compiled Seoul boundary", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        schema: 2,
        places: [
          {
            id: "osm-node-4",
            name: "고양시청",
            aliases: [],
            kind: "station",
            lat: 37.6584,
            lon: 126.832,
          },
        ],
      }),
    );

    await expect(loadSeoulPlaces(fetcher, "/")).rejects.toThrow(
      "INVALID_PLACE_DATA",
    );
  });
});
