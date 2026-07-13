import SunCalc from "suncalc";

export const MAX_SHADOW_LENGTH = 200;

export interface SunState {
  readonly altitude: number;
  readonly azimuth: number;
  readonly up: boolean;
  readonly dx: number;
  readonly dy: number;
  readonly lengthPerMeter: number;
}

export function sunState(date: Date, lat: number, lon: number): SunState {
  const position = SunCalc.getPosition(date, lat, lon);
  const up = position.altitude > 0.02;
  return {
    altitude: position.altitude,
    azimuth: position.azimuth,
    up,
    dx: Math.sin(position.azimuth),
    dy: Math.cos(position.azimuth),
    lengthPerMeter: up
      ? 1 / Math.tan(position.altitude)
      : Number.POSITIVE_INFINITY,
  };
}

export function shadowLength(height: number, sun: SunState): number {
  if (!sun.up) return MAX_SHADOW_LENGTH;
  return Math.min(height * sun.lengthPerMeter, MAX_SHADOW_LENGTH);
}

export function timeSlot(date: Date): number {
  return Math.floor(date.getTime() / (15 * 60 * 1_000));
}
