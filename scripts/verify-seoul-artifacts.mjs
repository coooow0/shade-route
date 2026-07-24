import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SEOUL_ARTIFACT_INTEGRITY } from "../src/data/seoulArtifactIntegrity.mjs";
import { verifySeoulArtifacts } from "./artifact-integrity.mjs";
import {
  verifyPublicBoundaryArtifact,
  verifyRuntimeBoundaryArtifact,
} from "./seoul-boundary-artifacts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = resolve(root, process.argv[2] ?? "public/data/seoul");
const result = await verifySeoulArtifacts(directory, SEOUL_ARTIFACT_INTEGRITY);
await verifyPublicBoundaryArtifact(
  resolve(root, "data-src/seoul-boundary.geojson"),
  resolve(directory, "boundary.json"),
);
await verifyRuntimeBoundaryArtifact(
  resolve(root, "data-src/seoul-boundary.geojson"),
  resolve(root, "src/data/seoulBoundary.ts"),
);
console.log(JSON.stringify(result));
