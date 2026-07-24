import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  publicBoundaryPayload,
  runtimeBoundaryModulePayload,
  verifyPublicBoundaryArtifact,
  verifyRuntimeBoundaryArtifact,
} from "./seoul-boundary-artifacts.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("runtime Seoul boundary artifact", () => {
  it("matches the checked-in runtime boundary generated from the source", async () => {
    const source = JSON.parse(
      await readFile(resolve("data-src/seoul-boundary.geojson"), "utf8"),
    );
    const actual = await readFile(resolve("src/data/seoulBoundary.ts"), "utf8");

    expect(actual).toBe(runtimeBoundaryModulePayload(source).payload);
  });

  it("rejects drift between source geometry and the runtime module", async () => {
    const directory = await mkdtemp(join(tmpdir(), "shade-route-boundary-"));
    temporaryDirectories.push(directory);
    const sourcePath = join(directory, "boundary.geojson");
    const outputPath = join(directory, "seoulBoundary.ts");
    const source = {
      type: "Polygon",
      coordinates: [
        [
          [126, 37],
          [127, 37],
          [127, 38],
          [126, 37],
        ],
      ],
    };
    await writeFile(sourcePath, JSON.stringify(source));
    await writeFile(
      outputPath,
      `${runtimeBoundaryModulePayload(source).payload}// drift`,
    );

    await expect(
      verifyRuntimeBoundaryArtifact(sourcePath, outputPath),
    ).rejects.toThrow("ARTIFACT_VERIFY_FAILED:runtime-boundary");
  });

  it("rejects drift between source geometry and the public boundary", async () => {
    const directory = await mkdtemp(join(tmpdir(), "shade-route-boundary-"));
    temporaryDirectories.push(directory);
    const sourcePath = join(directory, "boundary.geojson");
    const outputPath = join(directory, "boundary.json");
    const source = {
      type: "Polygon",
      coordinates: [
        [
          [126, 37],
          [127, 37],
          [127, 38],
          [126, 37],
        ],
      ],
    };
    await writeFile(sourcePath, JSON.stringify(source));
    await writeFile(outputPath, `${publicBoundaryPayload(source)} `);

    await expect(
      verifyPublicBoundaryArtifact(sourcePath, outputPath),
    ).rejects.toThrow("ARTIFACT_VERIFY_FAILED:public-boundary");
  });
});
