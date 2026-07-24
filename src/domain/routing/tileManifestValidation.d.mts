export interface TileManifestLimits {
  readonly artifactBytes: number;
  readonly manifestBytes: number;
  readonly policyEntries: number;
  readonly tileBytes: number;
  readonly tiles: number;
}

export const TILE_MANIFEST_LIMITS: Readonly<TileManifestLimits>;
export function isTileManifestShape(value: unknown): boolean;
