import { describe, expect, it, vi } from "vitest";
import {
  loadTiledRouteData,
  selectManifestTiles,
  type TileManifest,
} from "./tileRouteData";

const manifest: TileManifest = {
  schema: 1,
  zoom: 15,
  coverage: { south: 37.49, west: 127.02, north: 37.5, east: 127.04 },
  tiles: [
    {
      id: "15-27943-12699",
      bounds: { south: 37.49, west: 127.02, north: 37.5, east: 127.03 },
      bytes: 500,
    },
    {
      id: "15-27944-12699",
      bounds: { south: 37.49, west: 127.03, north: 37.5, east: 127.04 },
      bytes: 500,
    },
  ],
};

const way = (id: number, west: number, east: number) => ({
  type: "way",
  id,
  tags: { highway: "footway" },
  nodes: [id * 10, id * 10 + 1],
  geometry: [
    { lat: 37.495, lon: west },
    { lat: 37.495, lon: east },
  ],
});

const building = (id: number, lon: number) => ({
  type: "way",
  id,
  tags: { building: "yes", height: "12" },
  geometry: [
    { lat: 37.494, lon },
    { lat: 37.4942, lon },
    { lat: 37.4942, lon: lon + 0.0002 },
    { lat: 37.494, lon },
  ],
});

function response(value: unknown) {
  return new Response(JSON.stringify(value));
}

describe("tiled route data", () => {
  it("selects every tile intersecting the start-goal corridor", () => {
    const selected = selectManifestTiles(
      manifest,
      { lat: 37.495, lon: 127.025 },
      { lat: 37.495, lon: 127.035 },
      0,
    );

    expect(selected.map((tile) => tile.id)).toEqual([
      "15-27943-12699",
      "15-27944-12699",
    ]);
  });

  it("loads only selected tiles and deduplicates overlap elements", async () => {
    const fetcher = vi.fn<typeof fetch>((input) => {
      const url = String(input);
      if (url.endsWith("manifest.json"))
        return Promise.resolve(response(manifest));
      if (url.endsWith("15-27943-12699.json")) {
        return Promise.resolve(
          response({
            schema: 1,
            id: "15-27943-12699",
            ways: { elements: [way(1, 127.025, 127.03)] },
            buildings: { elements: [building(10, 127.027)] },
          }),
        );
      }
      if (url.endsWith("15-27944-12699.json")) {
        return Promise.resolve(
          response({
            schema: 1,
            id: "15-27944-12699",
            ways: {
              elements: [way(1, 127.025, 127.03), way(2, 127.03, 127.035)],
            },
            buildings: { elements: [building(11, 127.033)] },
          }),
        );
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const data = await loadTiledRouteData(
      { lat: 37.495, lon: 127.025 },
      { lat: 37.495, lon: 127.035 },
      fetcher,
      "/",
      0,
    );

    expect(data.ways.elements.map((element) => element.id)).toEqual([1, 2]);
    expect(data.buildings.elements.map((element) => element.id)).toEqual([
      10, 11,
    ]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("validates and expands compact Seoul tiles", async () => {
    const compactManifest: TileManifest = {
      ...manifest,
      tiles: [manifest.tiles[0]],
    };
    const fetcher = vi.fn<typeof fetch>((input) => {
      const url = String(input);
      if (url.endsWith("manifest.json")) {
        return Promise.resolve(response(compactManifest));
      }
      return Promise.resolve(
        response({
          schema: 2,
          id: "15-27943-12699",
          w: [[3, 7, [30, 31], [37495000, 127025000, 37495000, 127026000]]],
          b: [
            [
              20,
              12,
              null,
              [37494000, 127025000, 37494200, 127025000, 37494000, 127025200],
            ],
          ],
        }),
      );
    });

    const data = await loadTiledRouteData(
      { lat: 37.495, lon: 127.025 },
      { lat: 37.495, lon: 127.026 },
      fetcher,
      "/",
      0,
    );

    expect(data.ways.elements[0]).toMatchObject({
      id: 3,
      tags: {
        highway: "steps",
        covered: "yes",
        "shade-route:fallback": "yes",
      },
      geometry: [
        { lat: 37.495, lon: 127.025 },
        { lat: 37.495, lon: 127.026 },
      ],
    });
    expect(data.buildings.elements[0]).toMatchObject({
      id: 20,
      tags: { building: "yes", height: "12" },
    });
  });

  it("rejects malformed compact coordinate arrays", async () => {
    const compactManifest: TileManifest = {
      ...manifest,
      tiles: [manifest.tiles[0]],
    };
    const fetcher = vi.fn<typeof fetch>((input) =>
      Promise.resolve(
        String(input).endsWith("manifest.json")
          ? response(compactManifest)
          : response({
              schema: 2,
              id: "15-27943-12699",
              w: [[3, 0, [30, 31], [37495000, 127025000, 37495000]]],
              b: [],
            }),
      ),
    );

    await expect(
      loadTiledRouteData(
        { lat: 37.495, lon: 127.025 },
        { lat: 37.495, lon: 127.026 },
        fetcher,
        "/",
        0,
      ),
    ).rejects.toThrow("INVALID_TILE_DATA");
  });

  it("rejects unsafe tile ids before building request paths", async () => {
    const unsafeManifest = {
      ...manifest,
      tiles: [{ ...manifest.tiles[0], id: "../secret" }],
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(unsafeManifest));

    await expect(
      loadTiledRouteData(
        { lat: 37.495, lon: 127.025 },
        { lat: 37.495, lon: 127.026 },
        fetcher,
        "/",
        0,
      ),
    ).rejects.toThrow("INVALID_TILE_MANIFEST");
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
