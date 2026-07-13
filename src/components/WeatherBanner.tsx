import {
  uvRisk,
  weatherRecommendation,
  type CurrentWeather,
} from "../domain/weather/currentWeather";

interface WeatherBannerProps {
  readonly status: "loading" | "ready" | "error";
  readonly weather: CurrentWeather | null;
  readonly offsetMinutes?: number;
  readonly onRetry: () => void;
}

const UV_LABEL = {
  low: "낮음",
  moderate: "보통",
  high: "높음",
  "very-high": "매우 높음",
  extreme: "위험",
} as const;

function weatherSymbol(weather: CurrentWeather) {
  if (!weather.isDay) return "☾";
  if (weather.weatherCode >= 95) return "⛈";
  if (weather.weatherCode >= 51) return "☔";
  if (weather.weatherCode >= 45 || weather.weatherCode >= 2) return "☁";
  return "☀";
}

export default function WeatherBanner({
  status,
  weather,
  offsetMinutes = 0,
  onRetry,
}: WeatherBannerProps) {
  if (status === "loading") {
    return (
      <section className="weather-banner loading" role="status">
        <span className="weather-loading-dot" aria-hidden="true" />
        <span>서울 날씨를 확인하고 있어요</span>
      </section>
    );
  }

  if (status === "error" || weather === null) {
    return (
      <section className="weather-banner error" role="status">
        <div>
          <strong>날씨는 잠시 안 보여요</strong>
          <span>날씨 연결 없이도 경로를 찾을 수 있어요</span>
        </div>
        <button type="button" onClick={onRetry}>
          날씨 다시 불러오기
        </button>
      </section>
    );
  }

  const risk = uvRisk(weather.uvIndex);
  const advice =
    offsetMinutes > 0
      ? `${offsetMinutes}분 뒤 날씨 미반영 · 균형 경로 추천`
      : weatherRecommendation(weather);
  return (
    <section className={`weather-banner ready ${risk}`} aria-label="현재 날씨">
      <div className="weather-main">
        <span className="weather-symbol" aria-hidden="true">
          {weatherSymbol(weather)}
        </span>
        <div>
          <span className="weather-location">서울 현재</span>
          <strong>{Math.round(weather.temperatureC)}°</strong>
        </div>
      </div>
      <div className="weather-details">
        <div className="weather-badges">
          <span>체감 {Math.round(weather.apparentTemperatureC)}°</span>
          <span className={`uv-badge ${risk}`}>
            자외선 {UV_LABEL[risk]}
          </span>
        </div>
        <strong className="weather-advice">{advice}</strong>
        <small className="weather-source">
          <span>
            날씨 데이터{" "}
            <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
              Open-Meteo
            </a>{" "}
            ·{" "}
            <a
              href="https://creativecommons.org/licenses/by/4.0/"
              target="_blank"
              rel="noreferrer"
            >
              CC BY 4.0
            </a>
          </span>
          <span>좌표 반올림·UV 등급·경로 추천은 그늘길이 가공했어요</span>
        </small>
      </div>
    </section>
  );
}
