export type WalkDirection = "both" | "forward" | "backward";
export type OsmTags = Readonly<Record<string, string | undefined>>;

export function isSupportedWalkingTags(tags?: OsmTags): boolean;
export function isWalkableTags(tags?: OsmTags): boolean;
export function isFallbackRoad(tags?: OsmTags): boolean;
export function isBlockedWalkingNode(tags?: OsmTags): boolean;
export function walkDirectionFromTags(tags?: OsmTags): WalkDirection | null;
