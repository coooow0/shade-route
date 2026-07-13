import { describe, expect, it, vi } from "vitest";
import {
  loadCurrentWeather,
  uvRisk,
  weatherGuidance,
  weatherRecommendation,
} from "./currentWeather";

function response(value: unknown) {
  return new Response(JSON.stringify(value));
}

const apiWeather = {
  current: {
    time: "2026-07-12T17:15",
    temperature_2m: 31.6,
    apparent_temperature: 34.2,
    uv_index: 6.4,
    is_day: 1,
    weather_code: 1,
  },
};

describe("loadCurrentWeather", () => {
  it("rounds the coordinate and validates current Seoul weather", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(apiWeather));

    await expect(
      loadCurrentWeather({
        lat: 37.5007,
        lon: 127.0364,
        fetcher,
      }),
    ).resolves.toEqual({
      observedAt: "2026-07-12T17:15",
      temperatureC: 31.6,
      apparentTemperatureC: 34.2,
      uvIndex: 6.4,
      isDay: true,
      weatherCode: 1,
    });

    const [requestedUrl, init] = fetcher.mock.calls[0];
    const url = new URL(String(requestedUrl));
    expect(url.origin).toBe("https://api.open-meteo.com");
    expect(url.searchParams.get("latitude")).toBe("37.5");
    expect(url.searchParams.get("longitude")).toBe("127.04");
    expect(url.searchParams.get("timezone")).toBe("Asia/Seoul");
    expect(url.searchParams.get("forecast_days")).toBe("1");
    expect(url.searchParams.get("current")).toContain("uv_index");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects malformed weather and locations outside Seoul", async () => {
    const malformedFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ current: { ...apiWeather.current, uv_index: 99 } }));
    await expect(
      loadCurrentWeather({ lat: 37.5, lon: 127.03, fetcher: malformedFetcher }),
    ).rejects.toThrow("INVALID_WEATHER_DATA");

    const outsideFetcher = vi.fn<typeof fetch>();
    await expect(
      loadCurrentWeather({ lat: 35.1796, lon: 129.0756, fetcher: outsideFetcher }),
    ).rejects.toThrow("WEATHER_OUTSIDE_SEOUL");
    expect(outsideFetcher).not.toHaveBeenCalled();
  });
});

describe("weather guidance", () => {
  it.each([
    [2.9, "low"],
    [3, "moderate"],
    [6, "high"],
    [8, "very-high"],
    [11, "extreme"],
  ] as const)("classifies UV %s as %s", (uvIndex, expected) => {
    expect(uvRisk(uvIndex)).toBe(expected);
  });

  it("recommends shade for dangerous daytime heat and relaxes after sunset", () => {
    const hot = {
        temperatureC: 32,
        apparentTemperatureC: 35,
        uvIndex: 8.2,
        isDay: true,
        weatherCode: 0,
        observedAt: "2026-07-12T14:00",
      } as const;
    const night = {
        temperatureC: 25,
        apparentTemperatureC: 25,
        uvIndex: 0,
        isDay: false,
        weatherCode: 0,
        observedAt: "2026-07-12T22:00",
      } as const;

    expect(weatherGuidance(hot)).toEqual({
      mode: "maxShade",
      message: "그늘 우선 경로를 추천해요",
    });
    expect(weatherGuidance(night)).toEqual({
      mode: "shortest",
      message: "해가 진 시간이에요. 빠른길을 추천해요",
    });
    expect(weatherRecommendation(hot)).toContain("그늘 우선");
  });
});
