import { beforeEach, describe, expect, it, vi } from "vitest";

const isWithinSeoul = vi.hoisted(() =>
  vi.fn(
    (latitude: number, longitude: number) =>
      latitude === 37.5 && longitude === 127,
  ),
);

vi.mock("../location/serviceArea", () => ({ isWithinSeoul }));

import { loadSeoulPlaces } from "./loadSeoulPlaces";

describe("place boundary validation work", () => {
  beforeEach(() => {
    isWithinSeoul.mockClear();
  });

  it("checks the exact compiled coordinate before tolerance probes", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          schema: 2,
          places: [
            {
              id: "osm-node-1",
              name: "서울 장소",
              aliases: [],
              kind: "landmark",
              lat: 37.5,
              lon: 127,
            },
          ],
        }),
      ),
    );

    await expect(loadSeoulPlaces(fetcher, "/")).resolves.toHaveLength(1);
    expect(isWithinSeoul).toHaveBeenCalledOnce();
    expect(isWithinSeoul).toHaveBeenCalledWith(37.5, 127);
  });
});
