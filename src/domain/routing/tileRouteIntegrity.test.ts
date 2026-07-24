import { describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../data/integrity";
import {
  loadTiledRouteData,
  type SeoulArtifactIntegrity,
  type TileManifest,
} from "./tileRouteData";

const HASH = "0".repeat(64);
const tileId = "15-27943-12699";
const start = { lat: 37.495, lon: 127.025 };
const goal = { lat: 37.495, lon: 127.026 };

function tileBody(nodes = [10, 11]) {
  return JSON.stringify({
    schema: 2,
    id: tileId,
    w: [
      [
        1,
        0,
        nodes,
        [37_495_000, 127_025_000, 37_495_000, 127_026_000],
      ],
    ],
    b: [],
  });
}

async function signedManifest(body: string): Promise<TileManifest> {
  return {
    schema: 3,
    releaseId: "1".repeat(24),
    zoom: 15,
    coverage: { south: 37.49, west: 127.02, north: 37.5, east: 127.04 },
    source: {
      schema: 1,
      fileName: "south-korea-latest.osm.pbf",
      bytes: 1,
      sha256: HASH,
      observedModifiedAt: "2026-07-11T10:00:42.000Z",
      downloadUrl: null,
      downloadedAt: null,
    },
    generator: {
      schema: 3,
      script: "scripts/build-seoul-tiles.mjs",
    },
    artifacts: {
      places: { path: "places.json", bytes: 1, sha256: HASH },
      boundary: { path: "boundary.json", bytes: 1, sha256: HASH },
    },
    walkingPolicy: {
      schema: 1,
      excludedWayIds: [],
      blockedNodeIds: [],
      fallbackWayIds: [],
      directions: [],
    },
    tiles: [
      {
        id: tileId,
        bounds: { south: 37.49, west: 127.02, north: 37.5, east: 127.03 },
        bytes: new TextEncoder().encode(body).byteLength,
        sha256: await sha256Hex(body),
      },
    ],
  };
}

async function integrityFor(
  manifest: TileManifest,
): Promise<SeoulArtifactIntegrity> {
  return {
    schema: 1,
    releaseId: manifest.releaseId,
    manifestSha256: await sha256Hex(JSON.stringify(manifest)),
    placesSha256: manifest.artifacts.places.sha256,
  };
}

function fetcherFor(manifest: TileManifest, body: string) {
  return vi.fn<typeof fetch>((input) =>
    Promise.resolve(
      String(input).endsWith("manifest.json")
        ? new Response(JSON.stringify(manifest))
        : new Response(body),
    ),
  );
}

describe("route artifact integrity", () => {
  it("accepts an exact manifest and tile snapshot", async () => {
    const body = tileBody();
    const manifest = await signedManifest(body);

    await expect(
      loadTiledRouteData(
        start,
        goal,
        fetcherFor(manifest, body),
        "/",
        0,
        await integrityFor(manifest),
      ),
    ).resolves.toMatchObject({
      ways: { elements: [{ id: 1 }] },
    });
  });

  it("rejects an older same-id tile mixed with the current manifest", async () => {
    const trustedBody = tileBody();
    const oldBody = tileBody([20, 21]);
    const manifest = await signedManifest(trustedBody);

    await expect(
      loadTiledRouteData(
        start,
        goal,
        fetcherFor(manifest, oldBody),
        "/",
        0,
        await integrityFor(manifest),
      ),
    ).rejects.toThrow("ROUTE_ARTIFACT_MISMATCH");
  });

  it("rejects a changed manifest even when its changed tile hash matches", async () => {
    const trustedBody = tileBody();
    const trustedManifest = await signedManifest(trustedBody);
    const pinnedIntegrity = await integrityFor(trustedManifest);
    const changedBody = tileBody([20, 21]);
    const changedManifest = await signedManifest(changedBody);

    await expect(
      loadTiledRouteData(
        start,
        goal,
        fetcherFor(changedManifest, changedBody),
        "/",
        0,
        pinnedIntegrity,
      ),
    ).rejects.toThrow("ROUTE_ARTIFACT_MISMATCH");
  });

  it("rejects duplicate tile ids in an otherwise valid manifest", async () => {
    const body = tileBody();
    const manifest = await signedManifest(body);
    const duplicated = {
      ...manifest,
      tiles: [...manifest.tiles, manifest.tiles[0]],
    } satisfies TileManifest;

    await expect(
      loadTiledRouteData(
        start,
        goal,
        fetcherFor(duplicated, body),
        "/",
        0,
        await integrityFor(duplicated),
      ),
    ).rejects.toThrow("INVALID_TILE_MANIFEST");
  });
});
