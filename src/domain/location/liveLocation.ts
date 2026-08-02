import {
  Accuracy,
  startUpdateLocation,
  StartUpdateLocationPermissionError,
} from "@apps-in-toss/web-framework";
import { CurrentLocationError } from "./currentLocation";

const UPDATE_INTERVAL_MS = 3_000;
const UPDATE_DISTANCE_M = 10;

export interface LiveLocationSample {
  readonly lat: number;
  readonly lon: number;
  readonly accuracyM: number;
  readonly headingDeg?: number;
  readonly timestampMs: number;
}

export interface RawLiveLocation {
  readonly coords: {
    readonly latitude: number;
    readonly longitude: number;
    readonly accuracy: number;
    readonly heading?: number | null;
  };
  readonly timestamp: number;
}

interface ProviderHandlers {
  readonly onEvent: (location: RawLiveLocation) => void;
  readonly onError: (error: unknown) => void;
}

interface TossProviderHandlers extends ProviderHandlers {
  readonly options: {
    readonly accuracy: number;
    readonly timeInterval: number;
    readonly distanceInterval: number;
  };
}

export interface LiveLocationSources {
  readonly isTossEnvironment: () => boolean;
  readonly startToss: (handlers: TossProviderHandlers) => () => void;
  readonly startBrowser: (handlers: ProviderHandlers) => () => void;
}

interface LiveLocationHandlers {
  readonly onLocation: (sample: LiveLocationSample) => void;
  readonly onError: (error: CurrentLocationError) => void;
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

function startBrowser({ onEvent, onError }: ProviderHandlers) {
  if (typeof navigator === "undefined" || navigator.geolocation === undefined) {
    throw new CurrentLocationError("LOCATION_UNAVAILABLE");
  }

  const watchId = navigator.geolocation.watchPosition(
    (position) =>
      onEvent({
        coords: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          heading: position.coords.heading,
        },
        timestamp: position.timestamp,
      }),
    (error) =>
      onError(
        new CurrentLocationError(
          error.code === error.PERMISSION_DENIED
            ? "LOCATION_PERMISSION_DENIED"
            : "LOCATION_UNAVAILABLE",
        ),
      ),
    {
      enableHighAccuracy: true,
      maximumAge: 5_000,
      timeout: 12_000,
    },
  );

  return () => navigator.geolocation.clearWatch(watchId);
}

const defaultSources: LiveLocationSources = {
  isTossEnvironment,
  startToss: (handlers) => startUpdateLocation(handlers),
  startBrowser,
};

function normalizeError(error: unknown) {
  if (error instanceof CurrentLocationError) return error;
  if (error instanceof StartUpdateLocationPermissionError) {
    return new CurrentLocationError("LOCATION_PERMISSION_DENIED");
  }
  return new CurrentLocationError("LOCATION_UNAVAILABLE");
}

function normalizeLocation(location: RawLiveLocation): LiveLocationSample {
  const { latitude, longitude, accuracy, heading } = location.coords;
  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    !Number.isFinite(accuracy) ||
    accuracy < 0
  ) {
    throw new CurrentLocationError("LOCATION_UNAVAILABLE");
  }
  const normalizedHeading =
    typeof heading === "number" && Number.isFinite(heading)
      ? heading
      : undefined;
  return {
    lat: latitude,
    lon: longitude,
    accuracyM: accuracy,
    ...(normalizedHeading === undefined
      ? {}
      : { headingDeg: normalizedHeading }),
    timestampMs: Number.isFinite(location.timestamp)
      ? location.timestamp
      : Date.now(),
  };
}

export function subscribeLiveLocation(
  handlers: LiveLocationHandlers,
  sources: LiveLocationSources = defaultSources,
): () => void {
  let active = true;
  let cleaned = false;
  let providerCleanup: () => void = () => undefined;

  const onEvent = (location: RawLiveLocation) => {
    if (!active) return;
    try {
      handlers.onLocation(normalizeLocation(location));
    } catch (error) {
      handlers.onError(normalizeError(error));
    }
  };
  const onError = (error: unknown) => {
    if (active) handlers.onError(normalizeError(error));
  };

  try {
    providerCleanup = sources.isTossEnvironment()
      ? sources.startToss({
          options: {
            accuracy: Accuracy.High,
            timeInterval: UPDATE_INTERVAL_MS,
            distanceInterval: UPDATE_DISTANCE_M,
          },
          onEvent,
          onError,
        })
      : sources.startBrowser({ onEvent, onError });
  } catch (error) {
    onError(error);
  }

  return () => {
    if (cleaned) return;
    cleaned = true;
    active = false;
    try {
      providerCleanup();
    } catch {
      // Third-party cleanup is best-effort; the local subscription is already inactive.
    }
  };
}
