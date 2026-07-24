export interface SeoulArtifactIntegrityData {
  readonly schema: 1;
  readonly releaseId: string;
  readonly manifestSha256: string;
  readonly placesSha256: string;
}

export const SEOUL_ARTIFACT_INTEGRITY: Readonly<SeoulArtifactIntegrityData>;
