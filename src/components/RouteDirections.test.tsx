import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import RouteDirections from "./RouteDirections";
import { ROUTE_RESOURCE_LIMITS } from "../domain/routing/resourceLimits";
import type { Place, RouteResult } from "../domain/routing/types";

const goal: Place = { id: "goal", name: "역삼역", lat: 37.501, lon: 127.036 };
const route: RouteResult = {
  mode: "balanced",
  label: "균형",
  pathKey: "guide",
  timeSec: 750,
  lengthM: 895,
  sunSec: 240,
  shadeRatio: 0.62,
  segments: [
    {
      from: { lat: 37.499, lon: 127.028 },
      to: { lat: 37.5, lon: 127.028 },
      shadeRatio: 0.8,
      covered: false,
    },
    {
      from: { lat: 37.5, lon: 127.028 },
      to: { lat: 37.5, lon: 127.036 },
      shadeRatio: 0.2,
      covered: false,
    },
  ],
};

describe("RouteDirections", () => {
  it("shows an arrival summary, map, and expanded directions by default", () => {
    render(
      <RouteDirections
        route={route}
        requestedAt="2026-07-11T08:00:00.000Z"
        goal={goal}
      >
        <div data-testid="map-slot" />
      </RouteDirections>,
    );

    expect(screen.getByText("13분 · 895m")).toBeInTheDocument();
    expect(screen.getByText("예상 그늘 62%")).toBeInTheDocument();
    expect(screen.getByText("오후 5:12 도착")).toBeInTheDocument();
    expect(screen.getByTestId("map-slot")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "상세 경로" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "도보 경로 안내" })).toBeVisible();
    expect(screen.getByText("역삼역에 도착")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "상세 경로 접기" }));
    expect(screen.queryByLabelText("도보 경로 안내")).not.toBeInTheDocument();
    expect(screen.queryByText("역삼역에 도착")).not.toBeInTheDocument();
  });

  it("shows a calm fallback for empty geometry", () => {
    render(
      <RouteDirections
        route={{ ...route, segments: [] }}
        requestedAt="2026-07-11T08:00:00.000Z"
        goal={goal}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "상세 경로 안내를 만들 수 없어요.",
    );
  });

  it("expands the full direction list on request", () => {
    const points = [
      { lat: 37, lon: 127 },
      { lat: 37.001, lon: 127 },
      { lat: 37.001, lon: 127.001 },
      { lat: 37.002, lon: 127.001 },
      { lat: 37.002, lon: 127 },
      { lat: 37.003, lon: 127 },
      { lat: 37.003, lon: 127.001 },
      { lat: 37.004, lon: 127.001 },
    ];
    const longRoute: RouteResult = {
      ...route,
      pathKey: "long-guide",
      segments: points.slice(0, -1).map((from, index) => ({
        from,
        to: points[index + 1],
        shadeRatio: 0.5,
        covered: false,
      })),
    };

    render(
      <RouteDirections
        route={longRoute}
        requestedAt="2026-07-11T08:00:00.000Z"
        goal={goal}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(8);
    const collapse = screen.getByRole("button", { name: "상세 경로 접기" });
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(collapse);
    expect(screen.queryByLabelText("도보 경로 안내")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "상세 경로 8단계 보기" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("refuses to mount an excessive direction list", () => {
    let lat = 37;
    let lon = 127;
    const segments = Array.from(
      { length: ROUTE_RESOURCE_LIMITS.directionSteps },
      (_, index) => {
        const from = { lat, lon };
        if (index % 2 === 0) lat += 0.0001;
        else lon += 0.0001;
        return {
          from,
          to: { lat, lon },
          shadeRatio: 0.5,
          covered: false,
        };
      },
    );

    render(
      <RouteDirections
        route={{ ...route, pathKey: "excessive-guide", segments }}
        requestedAt="2026-07-11T08:00:00.000Z"
        goal={goal}
      />,
    );

    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(
      screen.getByText(/상세 경로가 너무 복잡해 표시하지 못했어요/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "상세 경로 접기" }));
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(
      screen.queryByText(/상세 경로가 너무 복잡해 표시하지 못했어요/),
    ).not.toBeInTheDocument();
  });
});
