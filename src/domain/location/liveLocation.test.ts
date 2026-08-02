import { afterEach, describe, expect, it, vi } from "vitest";
import { CurrentLocationError } from "./currentLocation";
import {
  subscribeLiveLocation,
  type LiveLocationSources,
  type RawLiveLocation,
} from "./liveLocation";

const seoulLocation: RawLiveLocation = {
  coords: {
    latitude: 37.4998,
    longitude: 127.031,
    accuracy: 9,
    heading: 82,
  },
  timestamp: 1_752_300_000_000,
};

function sources(
  overrides: Partial<LiveLocationSources> = {},
): LiveLocationSources {
  return {
    isTossEnvironment: () => true,
    startToss: vi.fn(() => vi.fn()),
    startBrowser: vi.fn(() => vi.fn()),
    ...overrides,
  };
}

describe("subscribeLiveLocation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("subscribes to Toss updates with walking-friendly options and cleans up once", () => {
    const cleanup = vi.fn();
    const startToss = vi.fn(({ onEvent }) => {
      onEvent(seoulLocation);
      return cleanup;
    });
    const locationSources = sources({ startToss });
    const onLocation = vi.fn();

    const unsubscribe = subscribeLiveLocation(
      { onLocation, onError: vi.fn() },
      locationSources,
    );

    expect(startToss).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          timeInterval: 3_000,
          distanceInterval: 10,
        }),
      }),
    );
    expect(onLocation).toHaveBeenCalledWith({
      lat: 37.4998,
      lon: 127.031,
      accuracyM: 9,
      headingDeg: 82,
      timestampMs: 1_752_300_000_000,
    });

    unsubscribe();
    unsubscribe();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("uses browser watchPosition only outside Toss and clears the same watch", () => {
    const cleanup = vi.fn();
    const startBrowser = vi.fn(({ onEvent }) => {
      onEvent(seoulLocation);
      return cleanup;
    });
    const locationSources = sources({
      isTossEnvironment: () => false,
      startBrowser,
    });

    const unsubscribe = subscribeLiveLocation(
      { onLocation: vi.fn(), onError: vi.fn() },
      locationSources,
    );

    expect(startBrowser).toHaveBeenCalledOnce();
    expect(locationSources.startToss).not.toHaveBeenCalled();
    unsubscribe();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("configures and cleans up the real browser geolocation boundary", () => {
    const clearWatch = vi.fn();
    const watchPosition = vi.fn((onSuccess, onError) => {
      onSuccess({
        coords: {
          latitude: seoulLocation.coords.latitude,
          longitude: seoulLocation.coords.longitude,
          accuracy: seoulLocation.coords.accuracy,
          heading: null,
        },
        timestamp: seoulLocation.timestamp,
      });
      onError({ code: 1, PERMISSION_DENIED: 1 });
      return 41;
    });
    vi.stubGlobal("navigator", {
      geolocation: { watchPosition, clearWatch },
    });
    const onLocation = vi.fn();
    const onError = vi.fn();

    const unsubscribe = subscribeLiveLocation({ onLocation, onError });

    expect(watchPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      {
        enableHighAccuracy: true,
        maximumAge: 5_000,
        timeout: 12_000,
      },
    );
    expect(onLocation).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 37.4998, lon: 127.031 }),
    );
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "LOCATION_PERMISSION_DENIED" }),
    );

    unsubscribe();
    expect(clearWatch).toHaveBeenCalledWith(41);
  });

  it("reports invalid samples but emits valid locations outside Seoul", () => {
    const startToss = vi.fn(({ onEvent }) => {
      onEvent({
        ...seoulLocation,
        coords: { ...seoulLocation.coords, latitude: Number.NaN },
      });
      onEvent({
        ...seoulLocation,
        coords: {
          ...seoulLocation.coords,
          latitude: 35.1796,
          longitude: 129.0756,
        },
      });
      onEvent({
        ...seoulLocation,
        coords: { ...seoulLocation.coords, accuracy: 120 },
      });
      return vi.fn();
    });
    const onLocation = vi.fn();
    const onError = vi.fn();

    subscribeLiveLocation({ onLocation, onError }, sources({ startToss }));

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "LOCATION_UNAVAILABLE" }),
    );
    expect(onLocation).toHaveBeenCalledTimes(2);
    expect(onLocation).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ lat: 35.1796, lon: 129.0756 }),
    );
    expect(onLocation).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ accuracyM: 120 }),
    );
  });

  it("ignores late events after unsubscribe", () => {
    let emit: ((location: RawLiveLocation) => void) | undefined;
    const startToss = vi.fn(({ onEvent }) => {
      emit = onEvent;
      return vi.fn();
    });
    const onLocation = vi.fn();
    const unsubscribe = subscribeLiveLocation(
      { onLocation, onError: vi.fn() },
      sources({ startToss }),
    );

    unsubscribe();
    emit?.(seoulLocation);

    expect(onLocation).not.toHaveBeenCalled();
  });

  it("contains provider cleanup failures", () => {
    const unsubscribe = subscribeLiveLocation(
      { onLocation: vi.fn(), onError: vi.fn() },
      sources({
        startToss: () => () => {
          throw new Error("cleanup failed");
        },
      }),
    );

    expect(() => unsubscribe()).not.toThrow();
    expect(() => unsubscribe()).not.toThrow();
  });

  it("contains synchronous provider failures", () => {
    const onError = vi.fn();
    const locationSources = sources({
      startToss: () => {
        throw new Error("bridge unavailable");
      },
    });

    expect(() =>
      subscribeLiveLocation({ onLocation: vi.fn(), onError }, locationSources),
    ).not.toThrow();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "LOCATION_UNAVAILABLE" }),
    );
  });

  it("preserves permission errors and never falls back after a Toss error", () => {
    const startBrowser = vi.fn(() => vi.fn());
    const onError = vi.fn();
    const permissionError = new CurrentLocationError(
      "LOCATION_PERMISSION_DENIED",
    );
    const startToss = vi.fn(({ onError: fail }) => {
      fail(permissionError);
      return vi.fn();
    });

    subscribeLiveLocation(
      { onLocation: vi.fn(), onError },
      sources({ startToss, startBrowser }),
    );

    expect(onError).toHaveBeenCalledWith(permissionError);
    expect(startBrowser).not.toHaveBeenCalled();
  });
});
