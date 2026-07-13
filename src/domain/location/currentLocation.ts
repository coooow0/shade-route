import {
  Accuracy,
  getCurrentLocation,
  GetCurrentLocationPermissionError,
} from "@apps-in-toss/web-framework";
import { isWithinSeoul } from "./serviceArea";
import type { Place } from "../routing/types";

const MAX_LOCATION_ACCURACY_M = 100;
const LOCATION_TIMEOUT_MS = 12_000;

export type CurrentLocationErrorCode =
  | "LOCATION_PERMISSION_DENIED"
  | "LOCATION_UNAVAILABLE"
  | "LOCATION_LOW_ACCURACY"
  | "OUTSIDE_SEOUL";

export class CurrentLocationError extends Error {
  readonly code: CurrentLocationErrorCode;

  constructor(code: CurrentLocationErrorCode) {
    super(code);
    this.name = "CurrentLocationError";
    this.code = code;
  }
}

export interface RawCurrentLocation {
  readonly lat: number;
  readonly lon: number;
  readonly accuracyM: number;
}

export interface CurrentLocationReaders {
  readonly isTossEnvironment: () => boolean;
  readonly readToss: () => Promise<RawCurrentLocation>;
  readonly readBrowser: () => Promise<RawCurrentLocation>;
}

function isTossEnvironment() {
  if (typeof window === "undefined") return false;
  const bridge = (
    window as Window & {
      ReactNativeWebView?: { postMessage?: unknown };
    }
  ).ReactNativeWebView;
  return typeof bridge?.postMessage === "function";
}

async function readToss(): Promise<RawCurrentLocation> {
  try {
    const location = await getCurrentLocation({ accuracy: Accuracy.High });
    return {
      lat: location.coords.latitude,
      lon: location.coords.longitude,
      accuracyM: location.coords.accuracy,
    };
  } catch (error) {
    if (error instanceof GetCurrentLocationPermissionError) {
      throw new CurrentLocationError("LOCATION_PERMISSION_DENIED");
    }
    throw new CurrentLocationError("LOCATION_UNAVAILABLE");
  }
}

function readBrowser(): Promise<RawCurrentLocation> {
  if (typeof navigator === "undefined" || navigator.geolocation === undefined) {
    return Promise.reject(new CurrentLocationError("LOCATION_UNAVAILABLE"));
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracyM: position.coords.accuracy,
        }),
      (error) =>
        reject(
          new CurrentLocationError(
            error.code === error.PERMISSION_DENIED
              ? "LOCATION_PERMISSION_DENIED"
              : "LOCATION_UNAVAILABLE",
          ),
        ),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  });
}

const defaultReaders: CurrentLocationReaders = {
  isTossEnvironment,
  readToss,
  readBrowser,
};

export async function requestCurrentLocationPermission() {
  if (!isTossEnvironment()) return false;
  try {
    return (await getCurrentLocation.openPermissionDialog()) === "allowed";
  } catch {
    return false;
  }
}

function withLocationTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(
      () => reject(new CurrentLocationError("LOCATION_UNAVAILABLE")),
      LOCATION_TIMEOUT_MS,
    );
    promise.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function resolveCurrentPlace(
  readers: CurrentLocationReaders = defaultReaders,
): Promise<Place> {
  let location: RawCurrentLocation;
  try {
    location = await withLocationTimeout(
      readers.isTossEnvironment() ? readers.readToss() : readers.readBrowser(),
    );
  } catch (error) {
    if (error instanceof CurrentLocationError) throw error;
    throw new CurrentLocationError("LOCATION_UNAVAILABLE");
  }

  if (
    !Number.isFinite(location.lat) ||
    !Number.isFinite(location.lon) ||
    !Number.isFinite(location.accuracyM) ||
    location.accuracyM < 0
  ) {
    throw new CurrentLocationError("LOCATION_UNAVAILABLE");
  }
  if (location.accuracyM > MAX_LOCATION_ACCURACY_M) {
    throw new CurrentLocationError("LOCATION_LOW_ACCURACY");
  }
  if (!isWithinSeoul(location.lat, location.lon)) {
    throw new CurrentLocationError("OUTSIDE_SEOUL");
  }
  return {
    id: "current-location",
    name: "현재 위치",
    lat: location.lat,
    lon: location.lon,
  };
}
