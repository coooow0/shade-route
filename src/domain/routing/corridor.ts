export const CORRIDOR_BOUNDS = {
  south: 37.494,
  west: 127.024,
  north: 37.502,
  east: 127.04,
} as const;

export function isWithinCorridor(lat: number, lon: number) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= CORRIDOR_BOUNDS.south &&
    lat <= CORRIDOR_BOUNDS.north &&
    lon >= CORRIDOR_BOUNDS.west &&
    lon <= CORRIDOR_BOUNDS.east
  );
}
