import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeRuntimeBoundaryArtifact } from "./seoul-boundary-artifacts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolve(root, "data-src/seoul-boundary.geojson");
const outputPath = resolve(root, "src/data/seoulBoundary.ts");
const result = await writeRuntimeBoundaryArtifact(inputPath, outputPath);
console.log(
  JSON.stringify({
    sourcePoints: result.sourcePoints,
    outputPoints: result.outputPoints,
  }),
);
