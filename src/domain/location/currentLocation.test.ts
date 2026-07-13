import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CurrentLocationError,
  resolveCurrentPlace,
  type CurrentLocationReaders,
} from "./currentLocation";

function readers(
  overrides: Partial<CurrentLocationReaders> = {},
): CurrentLocationReaders {
  return {
    isTossEnvironment: () => true,
    readToss: vi.fn().mockResolvedValue({
      lat: 37.4998,
      lon: 127.031,
      accuracyM: 8,
    }),
    readBrowser: vi.fn().mockRejectedValue(new Error("not used")),
    ...overrides,
  };
}

describe("resolveCurrentPlace", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes a Toss location anywhere inside Seoul", async () => {
    const locationReaders = readers({
      readToss: vi.fn().mockResolvedValue({
        lat: 37.5665,
        lon: 126.978,
        accuracyM: 8,
      }),
    });

    await expect(resolveCurrentPlace(locationReaders)).resolves.toEqual({
      id: "current-location",
      name: "현재 위치",
      lat: 37.5665,
      lon: 126.978,
    });
    expect(locationReaders.readToss).toHaveBeenCalledOnce();
    expect(locationReaders.readBrowser).not.toHaveBeenCalled();
  });

  it("rejects a location outside Seoul", async () => {
    const locationReaders = readers({
      readToss: vi.fn().mockResolvedValue({
        lat: 37.6584,
        lon: 126.832,
        accuracyM: 8,
      }),
    });

    await expect(resolveCurrentPlace(locationReaders)).rejects.toMatchObject({
      code: "OUTSIDE_SEOUL",
    });
  });

  it("does not fall back to the browser after Toss permission denial", async () => {
    const locationReaders = readers({
      readToss: vi
        .fn()
        .mockRejectedValue(
          new CurrentLocationError("LOCATION_PERMISSION_DENIED"),
        ),
    });

    await expect(resolveCurrentPlace(locationReaders)).rejects.toMatchObject({
      code: "LOCATION_PERMISSION_DENIED",
    });
    expect(locationReaders.readBrowser).not.toHaveBeenCalled();
  });

  it("uses browser geolocation only outside the Toss environment", async () => {
    const locationReaders = readers({
      isTossEnvironment: () => false,
      readBrowser: vi.fn().mockResolvedValue({
        lat: 37.5,
        lon: 127.032,
        accuracyM: 12,
      }),
    });

    await expect(resolveCurrentPlace(locationReaders)).resolves.toMatchObject({
      id: "current-location",
      lat: 37.5,
      lon: 127.032,
    });
    expect(locationReaders.readToss).not.toHaveBeenCalled();
    expect(locationReaders.readBrowser).toHaveBeenCalledOnce();
  });

  it("rejects invalid coordinates returned by a location provider", async () => {
    const locationReaders = readers({
      readToss: vi.fn().mockResolvedValue({
        lat: Number.NaN,
        lon: 127.032,
        accuracyM: 8,
      }),
    });

    await expect(resolveCurrentPlace(locationReaders)).rejects.toMatchObject({
      code: "LOCATION_UNAVAILABLE",
    });
  });

  it("rejects a fix too inaccurate for a 100m graph snap", async () => {
    const locationReaders = readers({
      readToss: vi.fn().mockResolvedValue({
        lat: 37.4998,
        lon: 127.031,
        accuracyM: 150,
      }),
    });

    await expect(resolveCurrentPlace(locationReaders)).rejects.toMatchObject({
      code: "LOCATION_LOW_ACCURACY",
    });
  });

  it("normalizes an unknown reader failure to unavailable", async () => {
    const locationReaders = readers({
      readToss: vi.fn().mockRejectedValue(new Error("GPS stopped")),
    });

    await expect(resolveCurrentPlace(locationReaders)).rejects.toMatchObject({
      code: "LOCATION_UNAVAILABLE",
    });
  });

  it("rejects a negative accuracy value as invalid", async () => {
    const locationReaders = readers({
      readToss: vi.fn().mockResolvedValue({
        lat: 37.4998,
        lon: 127.031,
        accuracyM: -1,
      }),
    });

    await expect(resolveCurrentPlace(locationReaders)).rejects.toMatchObject({
      code: "LOCATION_UNAVAILABLE",
    });
  });

  it("reads navigator geolocation in a regular browser", async () => {
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: (onSuccess: PositionCallback) =>
          onSuccess({
            coords: {
              latitude: 37.4998,
              longitude: 127.031,
              accuracy: 9,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
              toJSON: () => ({}),
            },
            timestamp: Date.now(),
            toJSON: () => ({}),
          }),
      },
    });

    await expect(resolveCurrentPlace()).resolves.toMatchObject({
      id: "current-location",
      lat: 37.4998,
      lon: 127.031,
    });
  });

  it("maps browser geolocation denial to a permission error", async () => {
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: (
          _onSuccess: PositionCallback,
          onError?: PositionErrorCallback | null,
        ) =>
          onError?.({
            code: 1,
            message: "denied",
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          }),
      },
    });

    await expect(resolveCurrentPlace()).rejects.toMatchObject({
      code: "LOCATION_PERMISSION_DENIED",
    });
  });

  it("times out a location reader that never responds", async () => {
    vi.useFakeTimers();
    const locationReaders = readers({
      readToss: vi.fn().mockReturnValue(new Promise(() => undefined)),
    });

    const locationPromise = resolveCurrentPlace(locationReaders);
    const rejection = expect(locationPromise).rejects.toMatchObject({
      code: "LOCATION_UNAVAILABLE",
    });
    await vi.advanceTimersByTimeAsync(12_000);

    await rejection;
    vi.useRealTimers();
  });
});
