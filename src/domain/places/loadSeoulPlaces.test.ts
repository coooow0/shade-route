import { describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../data/integrity";
import { loadSeoulPlaces } from "./loadSeoulPlaces";

function payload(value: unknown) {
  return JSON.stringify(value);
}

describe("loadSeoulPlaces", () => {
  it("loads searchable Seoul destinations with category and address metadata", async () => {
    const body = payload({
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
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(body),
    );

    await expect(
      loadSeoulPlaces(fetcher, "/", await sha256Hex(body)),
    ).resolves.toEqual([
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
    const body = payload({
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
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(body),
    );

    await expect(
      loadSeoulPlaces(fetcher, "/", await sha256Hex(body)),
    ).rejects.toThrow("INVALID_PLACE_DATA");
  });

  it("rejects a place index that does not match the bundled snapshot", async () => {
    const trusted = payload({ schema: 2, places: [] });
    const changed = `${trusted} `;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(changed));

    await expect(
      loadSeoulPlaces(fetcher, "/", await sha256Hex(trusted)),
    ).rejects.toThrow("PLACE_ARTIFACT_MISMATCH");
  });
});
