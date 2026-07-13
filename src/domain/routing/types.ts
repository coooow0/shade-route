export type XY = readonly [number, number];

export interface LatLng {
  readonly lat: number;
  readonly lon: number;
}

export interface OverpassGeometry {
  readonly lat: number;
  readonly lon: number;
}

export interface OverpassElement {
  readonly type: string;
  readonly id: number;
  readonly tags?: Readonly<Record<string, string | undefined>>;
  readonly nodes?: readonly number[];
  readonly geometry?: readonly OverpassGeometry[];
}

export interface OverpassData {
  readonly elements: readonly OverpassElement[];
}

export interface CorridorData {
  readonly ways: OverpassData;
  readonly buildings: OverpassData;
}

export interface Edge {
  readonly id: number;
  readonly a: number;
  readonly b: number;
  readonly length: number;
  readonly covered: boolean;
  readonly steps: boolean;
  readonly wayId: number;
  readonly fallbackRoad?: boolean;
  readonly virtual?: boolean;
}

export interface Graph {
  readonly nodes: ReadonlyMap<number, XY>;
  readonly edges: readonly Edge[];
  readonly adj: ReadonlyMap<number, readonly number[]>;
  readonly skippedWays?: number;
  readonly componentCount?: number;
  readonly droppedNodes?: number;
}

export interface Building {
  readonly id: number;
  readonly poly: readonly XY[];
  readonly height: number;
  readonly estimated: boolean;
}

export interface Place extends LatLng {
  readonly id: string;
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly address?: string;
  readonly kind?: PlaceKind;
}

export type PlaceKind =
  | "station"
  | "cafe"
  | "food"
  | "medical"
  | "education"
  | "store"
  | "office"
  | "park"
  | "landmark"
  | "building"
  | "address";

export type RouteMode = "shortest" | "balanced" | "maxShade";

export interface RouteSegment {
  readonly from: LatLng;
  readonly to: LatLng;
  readonly shadeRatio: number;
  readonly covered: boolean;
  readonly steps?: boolean;
  readonly connector?: boolean;
}

export interface RouteResult {
  readonly mode: RouteMode;
  readonly label: string;
  readonly pathKey: string;
  readonly timeSec: number;
  readonly lengthM: number;
  readonly sunSec: number;
  readonly shadeRatio: number;
  readonly segments: readonly RouteSegment[];
}

export interface RouteBundle {
  readonly requestedAt: string;
  readonly start: Place;
  readonly goal: Place;
  readonly routes: readonly RouteResult[];
}

export interface RouteRequest {
  readonly startId: string;
  readonly goalId: string;
  readonly offsetMinutes: number;
}

export interface RoutePlacesRequest {
  readonly start: Place;
  readonly goal: Place;
  readonly offsetMinutes: number;
}
