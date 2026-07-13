import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RouteMap, { type RouteMapMount } from "./RouteMap";
import type { Place, RouteResult } from "../domain/routing/types";

const start: Place = {
  id: "gangnam-11",
  name: "강남역 11번 출구",
  lat: 37.4995,
  lon: 127.0284,
};
const goal: Place = {
  id: "yeoksam",
  name: "역삼역",
  lat: 37.5007,
  lon: 127.0364,
};
const selected: RouteResult = {
  mode: "balanced",
  label: "균형",
  pathKey: "1:2",
  timeSec: 750,
  lengthM: 900,
  sunSec: 400,
  shadeRatio: 0.47,
  segments: [
    {
      from: { lat: start.lat, lon: start.lon },
      to: { lat: 37.5, lon: 127.032 },
      shadeRatio: 0.8,
      covered: false,
    },
    {
      from: { lat: 37.5, lon: 127.032 },
      to: { lat: goal.lat, lon: goal.lon },
      shadeRatio: 0.1,
      covered: false,
    },
  ],
};

describe("RouteMap", () => {
  it("mounts an interactive OpenStreetMap with route geometry", () => {
    const controller = {
      updateCurrentLocation: vi.fn(),
      destroy: vi.fn(),
    };
    const mountMap = vi.fn(() => controller) as RouteMapMount;

    render(
      <RouteMap
        route={selected}
        start={start}
        goal={goal}
        mountMap={mountMap}
      />,
    );

    const map = screen.getByRole("region", { name: "균형 경로 지도" });
    expect(map).toHaveAttribute("data-basemap", "openstreetmap");
    expect(mountMap).toHaveBeenCalledWith(
      expect.objectContaining({
        element: map,
        route: selected,
        start,
        goal,
      }),
    );
    expect(
      screen.getByRole("link", { name: "OpenStreetMap 기여자" }),
    ).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");
    expect(screen.getByLabelText("경로 범례")).toBeInTheDocument();
    expect(
      screen.getByText(/위치는 저장하지 않아요/),
    ).toBeInTheDocument();
  });

  it("shows raw live location, accuracy, following, and cautious off-route status", () => {
    const controller = {
      updateCurrentLocation: vi.fn(),
      destroy: vi.fn(),
    };
    const mountMap = vi.fn(() => controller) as RouteMapMount;
    let emit:
      | ((sample: {
          lat: number;
          lon: number;
          accuracyM: number;
          timestampMs: number;
        }) => void)
      | undefined;
    const stop = vi.fn();
    const subscribeLocation = vi.fn((handlers) => {
      emit = handlers.onLocation;
      return stop;
    });
    const { unmount } = render(
      <RouteMap
        route={selected}
        start={start}
        goal={goal}
        mountMap={mountMap}
        subscribeLocation={subscribeLocation}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "지도에 내 위치 표시" }),
    );
    const far = {
      lat: 37.502,
      lon: 127.032,
      accuracyM: 6,
      timestampMs: 1,
    };
    act(() => emit?.(far));

    expect(controller.updateCurrentLocation).toHaveBeenLastCalledWith(
      far,
      true,
    );
    expect(screen.getByText("내 위치 오차 약 6m")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "지도 자동 이동 켜짐" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.queryByText("경로를 벗어난 것 같아요"),
    ).not.toBeInTheDocument();

    act(() => {
      emit?.({ ...far, timestampMs: 2 });
      emit?.({ ...far, timestampMs: 3 });
    });
    expect(screen.getByText("경로를 벗어난 것 같아요")).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "지도 자동 이동 켜짐" }),
    );
    expect(controller.updateCurrentLocation).toHaveBeenLastCalledWith(
      expect.objectContaining({ timestampMs: 3 }),
      false,
    );

    unmount();
    expect(stop).toHaveBeenCalledOnce();
    expect(controller.destroy).toHaveBeenCalledOnce();
  });

  it("stops location updates when the app moves to the background", () => {
    const stop = vi.fn();
    const subscribeLocation = vi.fn(() => stop);

    render(
      <RouteMap
        route={selected}
        start={start}
        goal={goal}
        mountMap={() => ({
          updateCurrentLocation: vi.fn(),
          destroy: vi.fn(),
        })}
        subscribeLocation={subscribeLocation}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "지도에 내 위치 표시" }),
    );
    act(() => window.dispatchEvent(new Event("pagehide")));

    expect(stop).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("button", { name: "지도에 내 위치 표시" }),
    ).toBeEnabled();
  });

  it("stops location updates when the document becomes hidden", () => {
    const stop = vi.fn();
    const visibilityState = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");

    render(
      <RouteMap
        route={selected}
        start={start}
        goal={goal}
        mountMap={() => ({
          updateCurrentLocation: vi.fn(),
          destroy: vi.fn(),
        })}
        subscribeLocation={() => stop}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "지도에 내 위치 표시" }),
    );
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    expect(stop).toHaveBeenCalledOnce();
    visibilityState.mockRestore();
  });

  it("keeps the route area and explains when background tiles fail", () => {
    const mountMap = vi.fn(({ onTileError }) => {
      onTileError();
      return {
        updateCurrentLocation: vi.fn(),
        destroy: vi.fn(),
      };
    }) as RouteMapMount;

    render(
      <RouteMap
        route={selected}
        start={start}
        goal={goal}
        mountMap={mountMap}
      />,
    );

    expect(
      screen.getByRole("region", { name: "균형 경로 지도" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "지도 배경을 불러오지 못했어요. 경로는 계속 확인할 수 있어요.",
      ),
    ).toBeInTheDocument();
  });

  it("contains map initialization failures instead of crashing the app", () => {
    const mountMap = vi.fn(() => {
      throw new Error("MAP_INIT_FAILED");
    }) as RouteMapMount;

    render(
      <RouteMap
        route={selected}
        start={start}
        goal={goal}
        mountMap={mountMap}
      />,
    );

    expect(
      screen.getByRole("region", { name: "균형 경로 지도" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "지도를 시작하지 못했어요. 경로 요약은 계속 확인할 수 있어요.",
      ),
    ).toBeInTheDocument();
  });

  it("shows a fallback without mounting a map when geometry is empty", () => {
    const mountMap = vi.fn(() => ({
      updateCurrentLocation: vi.fn(),
      destroy: vi.fn(),
    })) as RouteMapMount;
    render(
      <RouteMap
        route={{ ...selected, segments: [] }}
        start={start}
        goal={goal}
        mountMap={mountMap}
      />,
    );

    expect(screen.getByText("표시할 경로가 없어요.")).toBeInTheDocument();
    expect(mountMap).not.toHaveBeenCalled();
  });
});
