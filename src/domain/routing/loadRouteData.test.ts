import { describe, expect, it, vi } from "vitest";
import { loadRouteData } from "./loadRouteData";

describe("loadRouteData", () => {
  it("loads both OSM datasets", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ elements: [{ type: "way", id: 1 }] })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ elements: [{ type: "way", id: 2 }] })),
      );

    const result = await loadRouteData(fetcher);

    expect(result.ways.elements).toHaveLength(1);
    expect(result.buildings.elements).toHaveLength(1);
  });

  it("rejects HTTP failures and malformed data", async () => {
    const failedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 503 }));
    await expect(loadRouteData(failedFetch)).rejects.toThrow("LOAD_FAILED");

    const invalidFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ invalid: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ invalid: true })));
    await expect(loadRouteData(invalidFetch)).rejects.toThrow("INVALID_DATA");
  });

  it("rejects invalid coordinates before routing", async () => {
    const invalidGeometry = {
      elements: [{ type: "way", id: 1, geometry: [{ lat: "bad", lon: 127 }] }],
    };
    const invalidFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(invalidGeometry)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ elements: [] })));

    await expect(loadRouteData(invalidFetch)).rejects.toThrow("INVALID_DATA");
  });

  it("rejects malformed OSM tags before graph parsing", async () => {
    const malformedTags = {
      elements: [{ type: "way", id: 1, tags: { highway: 123 } }],
    };
    const invalidFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(malformedTags)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ elements: [] })));

    await expect(loadRouteData(invalidFetch)).rejects.toThrow("INVALID_DATA");
  });

  it("rejects oversized responses before parsing them", async () => {
    const response = new Response(JSON.stringify({ elements: [] }), {
      headers: { "content-length": "5000001" },
    });
    const oversizedFetch = vi.fn<typeof fetch>().mockResolvedValue(response);

    await expect(loadRouteData(oversizedFetch)).rejects.toThrow("INVALID_DATA");
  });

  it("rejects an oversized body when content-length is unavailable", async () => {
    const oversizedFetch = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response("x".repeat(5_000_001)));

    await expect(loadRouteData(oversizedFetch)).rejects.toThrow("INVALID_DATA");
  });
});
