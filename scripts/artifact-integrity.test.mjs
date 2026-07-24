import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  artifactEntry,
  releaseIdFor,
  sha256Hex,
  verifySeoulArtifacts,
} from "./artifact-integrity.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function writeFixture(changeDescriptor = (descriptor) => descriptor) {
  const directory = await mkdtemp(join(tmpdir(), "shade-route-artifacts-"));
  temporaryDirectories.push(directory);
  await mkdir(join(directory, "tiles"));

  const tilePayload = '{"schema":2,"id":"15-1-1","w":[],"b":[]}';
  const placesPayload = '{"schema":2,"places":[]}\n';
  const boundaryPayload = '{"type":"Polygon","coordinates":[]}\n';
  const descriptor = changeDescriptor({
    schema: 3,
    zoom: 15,
    coverage: { south: 37, west: 126, north: 38, east: 128 },
    source: {
      schema: 1,
      fileName: "south-korea-latest.osm.pbf",
      bytes: 123,
      sha256: sha256Hex("source"),
      observedModifiedAt: "2026-07-15T00:00:00.000Z",
      downloadUrl: null,
      downloadedAt: null,
    },
    generator: {
      schema: 3,
      script: "scripts/build-seoul-tiles.mjs",
    },
    artifacts: {
      places: artifactEntry("places.json", placesPayload),
      boundary: artifactEntry("boundary.json", boundaryPayload),
    },
    tiles: [
      {
        id: "15-1-1",
        bounds: { south: 37, west: 126, north: 37.1, east: 126.1 },
        bytes: Buffer.byteLength(tilePayload),
        sha256: sha256Hex(tilePayload),
      },
    ],
    walkingPolicy: {
      schema: 1,
      excludedWayIds: [],
      blockedNodeIds: [],
      fallbackWayIds: [],
      directions: [],
    },
  });
  const releaseId = releaseIdFor(descriptor);
  const manifestPayload = `${JSON.stringify({ ...descriptor, releaseId })}\n`;
  const integrity = {
    schema: 1,
    releaseId,
    manifestSha256: sha256Hex(manifestPayload),
    placesSha256: descriptor.artifacts.places.sha256,
  };

  await Promise.all([
    writeFile(join(directory, "manifest.json"), manifestPayload),
    writeFile(join(directory, "places.json"), placesPayload),
    writeFile(join(directory, "boundary.json"), boundaryPayload),
    writeFile(join(directory, "tiles/15-1-1.json"), tilePayload),
  ]);
  return { directory, integrity };
}

describe("verifySeoulArtifacts", () => {
  it("accepts a complete artifact set", async () => {
    const fixture = await writeFixture();

    await expect(
      verifySeoulArtifacts(fixture.directory, fixture.integrity),
    ).resolves.toMatchObject({ tiles: 1 });
  });

  it("rejects an empty manifest before accepting a deployable release", async () => {
    const fixture = await writeFixture((descriptor) => ({
      ...descriptor,
      tiles: [],
    }));

    await expect(
      verifySeoulArtifacts(fixture.directory, fixture.integrity),
    ).rejects.toThrow("ARTIFACT_VERIFY_FAILED:manifest:shape");
  });

  it("rejects a manifest above the runtime tile-count limit", async () => {
    const fixture = await writeFixture((descriptor) => ({
      ...descriptor,
      tiles: Array.from({ length: 2_001 }, (_, index) => ({
        ...descriptor.tiles[0],
        id: `15-${index + 1}-1`,
      })),
    }));

    await expect(
      verifySeoulArtifacts(fixture.directory, fixture.integrity),
    ).rejects.toThrow("ARTIFACT_VERIFY_FAILED:manifest:shape");
  });

  it("rejects a manifest above the runtime byte limit", async () => {
    const fixture = await writeFixture((descriptor) => ({
      ...descriptor,
      padding: "x".repeat(1_000_000),
    }));

    await expect(
      verifySeoulArtifacts(fixture.directory, fixture.integrity),
    ).rejects.toThrow("ARTIFACT_VERIFY_FAILED:manifest:bytes");
  });

  it.each([
    ["source metadata", (descriptor) => ({ ...descriptor, source: null })],
    [
      "coverage bounds",
      (descriptor) => ({
        ...descriptor,
        coverage: { ...descriptor.coverage, north: descriptor.coverage.south },
      }),
    ],
    [
      "generator metadata",
      (descriptor) => ({
        ...descriptor,
        generator: { ...descriptor.generator, script: "other-script.mjs" },
      }),
    ],
    [
      "walking policy",
      (descriptor) => ({
        ...descriptor,
        walkingPolicy: { ...descriptor.walkingPolicy, excludedWayIds: [2, 1] },
      }),
    ],
    [
      "tile byte limit",
      (descriptor) => ({
        ...descriptor,
        tiles: [{ ...descriptor.tiles[0], bytes: 2_000_001 }],
      }),
    ],
    [
      "artifact byte limit",
      (descriptor) => ({
        ...descriptor,
        artifacts: {
          ...descriptor.artifacts,
          places: { ...descriptor.artifacts.places, bytes: 12_000_001 },
        },
      }),
    ],
  ])("rejects malformed %s", async (_label, changeDescriptor) => {
    const fixture = await writeFixture(changeDescriptor);

    await expect(
      verifySeoulArtifacts(fixture.directory, fixture.integrity),
    ).rejects.toThrow("ARTIFACT_VERIFY_FAILED:manifest:shape");
  });

  it("rejects unexpected files in the tile directory", async () => {
    const fixture = await writeFixture();
    await writeFile(join(fixture.directory, "tiles/README.txt"), "unexpected");

    await expect(
      verifySeoulArtifacts(fixture.directory, fixture.integrity),
    ).rejects.toThrow("ARTIFACT_VERIFY_FAILED:tiles:file-set");
  });
});
