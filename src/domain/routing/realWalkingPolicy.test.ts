import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface CompiledManifest {
  readonly schema: number;
  readonly walkingPolicy: {
    readonly excludedWayIds: readonly number[];
    readonly blockedNodeIds: readonly number[];
    readonly fallbackWayIds: readonly number[];
    readonly directions: readonly (readonly [number, 1 | -1])[];
  };
}

interface CompiledTile {
  readonly schema: number;
  readonly w: readonly (readonly [
    number,
    number,
    readonly number[],
    readonly number[],
  ])[];
}

describe("compiled Seoul walking policy", () => {
  it("removes excluded ways and references only emitted direction and barrier ids", async () => {
    const dataDirectory = resolve(process.cwd(), "public/data/seoul");
    const manifest = JSON.parse(
      await readFile(resolve(dataDirectory, "manifest.json"), "utf8"),
    ) as CompiledManifest;
    const emittedWays = new Set<number>();
    const emittedNodes = new Set<number>();
    const fallbackWays = new Set<number>();

    for (const file of await readdir(resolve(dataDirectory, "tiles"))) {
      const tile = JSON.parse(
        await readFile(resolve(dataDirectory, "tiles", file), "utf8"),
      ) as CompiledTile;
      expect(tile.schema).toBe(2);
      for (const [wayId, flags, nodeIds] of tile.w) {
        emittedWays.add(wayId);
        if (flags & 4) fallbackWays.add(wayId);
        for (const nodeId of nodeIds) emittedNodes.add(nodeId);
      }
    }

    expect(manifest.schema).toBe(3);
    expect(
      manifest.walkingPolicy.excludedWayIds.some((id) => emittedWays.has(id)),
    ).toBe(false);
    expect(
      manifest.walkingPolicy.directions.every(([id]) => emittedWays.has(id)),
    ).toBe(true);
    expect(
      manifest.walkingPolicy.blockedNodeIds.every((id) => emittedNodes.has(id)),
    ).toBe(true);
    expect(
      manifest.walkingPolicy.fallbackWayIds.every((id) => fallbackWays.has(id)),
    ).toBe(true);
  }, 20_000);
});
