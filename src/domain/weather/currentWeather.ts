import { fetchJsonWithLimit } from "../data/fetchJson";
import { isWithinSeoul } from "../location/serviceArea";

const WEATHER_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const CURRENT_FIELDS = [
  "temperature_2m",
  "apparent_temperature",
  "uv_index",
  "is_day",
  "weather_code",
].join(",");

export interface CurrentWeather {
  readonly observedAt: string;
  readonly temperatureC: number;
  readonly apparentTemperatureC: number;
  readonly uvIndex: number;
  readonly isDay: boolean;
  readonly weatherCode: number;
}

export type UvRisk = "low" | "moderate" | "high" | "very-high" | "extreme";
export type WeatherRecommendedMode = "shortest" | "balanced" | "maxShade";

export interface WeatherGuidance {
  readonly mode: WeatherRecommendedMode;
  readonly message: string;
}

interface LoadCurrentWeatherOptions {
  readonly lat: number;
  readonly lon: number;
  readonly fetcher?: typeof fetch;
}

function finiteInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function parseCurrentWeather(value: unknown): CurrentWeather {
  if (typeof value !== "object" || value === null) {
    throw new Error("INVALID_WEATHER_DATA");
  }
  const current = (value as { current?: unknown }).current;
  if (typeof current !== "object" || current === null) {
    throw new Error("INVALID_WEATHER_DATA");
  }
  const data = current as Record<string, unknown>;
  if (
    typeof data.time !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u.test(data.time) ||
    !finiteInRange(data.temperature_2m, -60, 60) ||
    !finiteInRange(data.apparent_temperature, -80, 80) ||
    !finiteInRange(data.uv_index, 0, 20) ||
    (data.is_day !== 0 && data.is_day !== 1) ||
    !finiteInRange(data.weather_code, 0, 99) ||
    !Number.isInteger(data.weather_code)
  ) {
    throw new Error("INVALID_WEATHER_DATA");
  }
  return {
    observedAt: data.time,
    temperatureC: data.temperature_2m,
    apparentTemperatureC: data.apparent_temperature,
    uvIndex: data.uv_index,
    isDay: data.is_day === 1,
    weatherCode: data.weather_code,
  };
}

export function uvRisk(uvIndex: number): UvRisk {
  if (uvIndex < 3) return "low";
  if (uvIndex < 6) return "moderate";
  if (uvIndex < 8) return "high";
  if (uvIndex < 11) return "very-high";
  return "extreme";
}

export function weatherGuidance(weather: CurrentWeather): WeatherGuidance {
  if (!weather.isDay) {
    return {
      mode: "shortest",
      message: "해가 진 시간이에요. 빠른길을 추천해요",
    };
  }
  if (weather.uvIndex >= 6 || weather.apparentTemperatureC >= 30) {
    return { mode: "maxShade", message: "그늘 우선 경로를 추천해요" };
  }
  if (weather.uvIndex >= 3 || weather.apparentTemperatureC >= 27) {
    return { mode: "balanced", message: "균형 경로로 햇빛을 줄여보세요" };
  }
  return { mode: "shortest", message: "지금은 빠른길을 추천해요" };
}

export function weatherRecommendation(weather: CurrentWeather) {
  return weatherGuidance(weather).message;
}

export async function loadCurrentWeather({
  lat,
  lon,
  fetcher = fetch,
}: LoadCurrentWeatherOptions): Promise<CurrentWeather> {
  if (!isWithinSeoul(lat, lon)) throw new Error("WEATHER_OUTSIDE_SEOUL");
  const url = new URL(WEATHER_ENDPOINT);
  url.searchParams.set("latitude", String(Number(lat.toFixed(2))));
  url.searchParams.set("longitude", String(Number(lon.toFixed(2))));
  url.searchParams.set("current", CURRENT_FIELDS);
  url.searchParams.set("timezone", "Asia/Seoul");
  url.searchParams.set("forecast_days", "1");
  const response = await fetchJsonWithLimit({
    fetcher,
    url: url.toString(),
    maxBytes: 50_000,
    loadError: "WEATHER_LOAD_FAILED",
    invalidError: "INVALID_WEATHER_DATA",
    timeoutMs: 6_000,
  });
  return parseCurrentWeather(response);
}
