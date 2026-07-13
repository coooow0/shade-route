import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import WeatherBanner from "./WeatherBanner";

const weather = {
  observedAt: "2026-07-12T17:15",
  temperatureC: 31.6,
  apparentTemperatureC: 34.2,
  uvIndex: 6.4,
  isDay: true,
  weatherCode: 1,
} as const;

describe("WeatherBanner", () => {
  it("shows a compact loading state without blocking route search", () => {
    render(<WeatherBanner status="loading" weather={null} onRetry={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("서울 날씨를 확인하고 있어요");
  });

  it("explains temperature, UV risk and the recommended route", () => {
    render(<WeatherBanner status="ready" weather={weather} onRetry={vi.fn()} />);

    expect(screen.getByRole("region", { name: "현재 날씨" })).toHaveTextContent("32°");
    expect(screen.getByText("서울 현재")).toBeVisible();
    expect(screen.getByText("체감 34°")).toBeVisible();
    expect(screen.getByText("자외선 높음")).toBeVisible();
    expect(screen.getByText("그늘 우선 경로를 추천해요")).toBeVisible();
    expect(screen.getByText("Open-Meteo")).toBeVisible();
    expect(screen.getByRole("link", { name: "CC BY 4.0" })).toBeVisible();
    expect(screen.getByText("좌표 반올림·UV 등급·경로 추천은 그늘길이 가공했어요")).toBeVisible();
  });

  it("does not present current conditions as a future-weather forecast", () => {
    render(
      <WeatherBanner
        status="ready"
        weather={weather}
        offsetMinutes={30}
        onRetry={vi.fn()}
      />,
    );

    expect(
      screen.getByText("30분 뒤 날씨 미반영 · 균형 경로 추천"),
    ).toBeVisible();
    expect(screen.queryByText("그늘 우선 경로를 추천해요")).not.toBeInTheDocument();
  });

  it("keeps the app usable and retries after a weather failure", () => {
    const onRetry = vi.fn();
    render(<WeatherBanner status="error" weather={null} onRetry={onRetry} />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "날씨 연결 없이도 경로를 찾을 수 있어요",
    );
    fireEvent.click(screen.getByRole("button", { name: "날씨 다시 불러오기" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
