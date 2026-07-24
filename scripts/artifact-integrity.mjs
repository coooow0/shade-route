import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  isTileManifestShape,
  TILE_MANIFEST_LIMITS,
} from "../src/domain/routing/tileManifestValidation.mjs";

const SHA256_HEX = /^[a-f0-9]{64}$/;
const RELEASE_ID = /^[a-f0-9]{24}$/;

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function artifactEntry(path, payload) {
  return {
    path,
    bytes: Buffer.byteLength(payload),
    sha256: sha256Hex(payload),
  };
}

export function releaseIdFor(descriptor) {
  return sha256Hex(JSON.stringify(descriptor)).slice(0, 24);
}

function fail(reason) {
  throw new Error(`ARTIFACT_VERIFY_FAILED:${reason}`);
}

async function verifyFile(directory, entry) {
  const payload = await readFile(join(directory, entry.path));
  if (payload.byteLength !== entry.bytes) fail(`${entry.path}:bytes`);
  if (sha256Hex(payload) !== entry.sha256) fail(`${entry.path}:sha256`);
}

export async function verifySeoulArtifacts(directory, integrity) {
  if (
    integrity?.schema !== 1 ||
    !RELEASE_ID.test(integrity.releaseId) ||
    !SHA256_HEX.test(integrity.manifestSha256) ||
    !SHA256_HEX.test(integrity.placesSha256)
  ) {
    fail("integrity-root");
  }

  const manifestPayload = await readFile(join(directory, "manifest.json"));
  if (manifestPayload.byteLength > TILE_MANIFEST_LIMITS.manifestBytes) {
    fail("manifest:bytes");
  }
  if (sha256Hex(manifestPayload) !== integrity.manifestSha256) {
    fail("manifest:sha256");
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestPayload.toString("utf8"));
  } catch {
    fail("manifest:json");
  }
  if (
    !isTileManifestShape(manifest) ||
    manifest.releaseId !== integrity.releaseId ||
    manifest.artifacts.places.sha256 !== integrity.placesSha256
  ) {
    fail("manifest:shape");
  }
  const { releaseId, ...descriptor } = manifest;
  if (releaseId !== releaseIdFor(descriptor)) fail("manifest:release-id");

  const expectedTileFiles = new Set();
  let totalTileBytes = 0;
  for (const entry of manifest.tiles) {
    const path = `tiles/${entry.id}.json`;
    expectedTileFiles.add(`${entry.id}.json`);
    await verifyFile(directory, { ...entry, path });
    totalTileBytes += entry.bytes;
  }

  const actualTileFiles = await readdir(join(directory, "tiles"));
  if (
    actualTileFiles.length !== expectedTileFiles.size ||
    actualTileFiles.some((name) => !expectedTileFiles.has(name))
  ) {
    fail("tiles:file-set");
  }

  await verifyFile(directory, manifest.artifacts.places);
  await verifyFile(directory, manifest.artifacts.boundary);
  return {
    releaseId,
    tiles: manifest.tiles.length,
    totalTileBytes,
    manifestBytes: manifestPayload.byteLength,
  };
}
