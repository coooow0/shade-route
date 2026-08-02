import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { trackRouteResultView } from "./domain/analytics/routeAnalytics";
import { loadSeoulPlaces } from "./domain/places/loadSeoulPlaces";
import {
  CurrentLocationError,
  requestCurrentLocationPermission,
  resolveCurrentPlace,
} from "./domain/location/currentLocation";
import { calculateRouteBundleForPlaces } from "./domain/routing/routeWorkerClient";
import { loadCurrentWeather } from "./domain/weather/currentWeather";
import type { RouteBundle, RouteResult } from "./domain/routing/types";

vi.mock("./domain/analytics/routeAnalytics", () => ({
  trackRouteResultView: vi.fn(),
}));

vi.mock("./domain/routing/routeWorkerClient", () => ({
  calculateRouteBundleForPlaces: vi.fn(),
}));

vi.mock("./domain/location/currentLocation", async () => {
  const actual = await vi.importActual<
    typeof import("./domain/location/currentLocation")
  >("./domain/location/currentLocation");
  return {
    ...actual,
    requestCurrentLocationPermission: vi.fn(),
    resolveCurrentPlace: vi.fn(),
  };
});

vi.mock("./domain/places/loadSeoulPlaces", () => ({
  loadSeoulPlaces: vi.fn(),
}));

vi.mock("./domain/weather/currentWeather", async () => {
  const actual = await vi.importActual<
    typeof import("./domain/weather/currentWeather")
  >("./domain/weather/currentWeather");
  return { ...actual, loadCurrentWeather: vi.fn() };
});

const mockedCalculate = vi.mocked(calculateRouteBundleForPlaces);
const mockedTrackRouteResultView = vi.mocked(trackRouteResultView);
const mockedLocation = vi.mocked(resolveCurrentPlace);
const mockedPermissionRequest = vi.mocked(requestCurrentLocationPermission);
const mockedPlaces = vi.mocked(loadSeoulPlaces);
const mockedWeather = vi.mocked(loadCurrentWeather);

const mildWeather = {
  observedAt: "2026-07-12T17:15",
  temperatureC: 27,
  apparentTemperatureC: 28,
  uvIndex: 4,
  isDay: true,
  weatherCode: 1,
} as const;

function startInput() {
  return screen.getByRole("combobox", { name: "출발지 검색" });
}

function goalInput() {
  return screen.getByRole("combobox", { name: "도착지 검색" });
}

function choosePlace(field: HTMLElement, query: string, resultName: string) {
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: query } });
  const resultText = screen.getByText(resultName);
  const option = resultText.closest<HTMLElement>("[role='option']");
  if (!option) throw new Error(`Missing option for ${resultName}`);
  fireEvent.click(option);
}

const route = (
  mode: RouteResult["mode"],
  label: string,
  overrides: Partial<RouteResult> = {},
): RouteResult => ({
  mode,
  label,
  pathKey: mode,
  timeSec: 720,
  lengthM: 880,
  sunSec: 480,
  shadeRatio: 0.33,
  segments: [
    {
      from: { lat: 37.4995, lon: 127.0284 },
      to: { lat: 37.5007, lon: 127.0364 },
      shadeRatio: mode === "maxShade" ? 0.8 : 0.2,
      covered: false,
    },
  ],
  ...overrides,
});

const bundle: RouteBundle = {
  requestedAt: "2026-07-11T08:00:00.000Z",
  start: {
    id: "gangnam-11",
    name: "강남역 11번 출구",
    lat: 37.4995,
    lon: 127.0284,
  },
  goal: { id: "yeoksam", name: "역삼역", lat: 37.5007, lon: 127.0364 },
  routes: [
    route("shortest", "빠른길"),
    route("balanced", "균형", { timeSec: 750, sunSec: 430, shadeRatio: 0.43 }),
    route("maxShade", "그늘우선", {
      timeSec: 900,
      sunSec: 360,
      shadeRatio: 0.6,
    }),
  ],
};

// 요약 문장은 숫자만 강조하려고 여러 조각으로 나뉜다. getByText는 자식 요소가 있는
// 노드를 건너뛰므로 문단 전체 텍스트를 직접 읽는다.
function routeSummaryText() {
  const summary = document.querySelector(".c-sheet-summary p");
  if (!(summary instanceof HTMLElement)) {
    throw new Error("Missing route summary");
  }
  return summary.textContent;
}

function mockResultSheetLayout(sheet: HTMLElement) {
  const header = sheet.querySelector("thead");
  const timeOptions = sheet.querySelector(".c-sheet-time");
  if (
    !(header instanceof HTMLElement) ||
    !(timeOptions instanceof HTMLElement)
  ) {
    throw new Error("Missing result sheet peek content");
  }
  Object.defineProperty(sheet, "scrollHeight", {
    configurable: true,
    value: 500,
  });
  vi.spyOn(sheet, "getBoundingClientRect").mockReturnValue({
    top: 0,
    right: 390,
    bottom: 500,
    left: 0,
    width: 390,
    height: 500,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  vi.spyOn(header, "getBoundingClientRect").mockReturnValue({
    top: 44,
    right: 390,
    bottom: 96,
    left: 0,
    width: 390,
    height: 52,
    x: 0,
    y: 44,
    toJSON: () => ({}),
  });
  vi.spyOn(timeOptions, "getBoundingClientRect").mockReturnValue({
    top: 260,
    right: 390,
    bottom: 304,
    left: 0,
    width: 390,
    height: 44,
    x: 0,
    y: 260,
    toJSON: () => ({}),
  });
}

describe("App", () => {
  beforeEach(() => {
    mockedCalculate.mockReset();
    mockedTrackRouteResultView.mockReset();
    mockedLocation.mockReset();
    mockedPermissionRequest.mockReset();
    mockedPlaces.mockReset();
    mockedWeather.mockReset();
    mockedPlaces.mockResolvedValue([]);
    mockedWeather.mockResolvedValue(mildWeather);
  });

  it("starts with the corridor search controls", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { name: "오늘, 햇빛을 덜 받는 길" }),
    ).toBeInTheDocument();
    expect(startInput()).toHaveValue("강남역 11번 출구");
    expect(goalInput()).toHaveValue("역삼역");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "그늘 경로 찾기" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "현재 위치로 출발" }),
    ).toBeEnabled();
  });

  it("shows current weather without blocking route search", async () => {
    render(<App />);

    expect(
      screen.getByRole("button", { name: "그늘 경로 찾기" }),
    ).toBeEnabled();
    expect(
      await screen.findByRole("region", { name: "현재 날씨" }),
    ).toHaveTextContent("27°");
    expect(mockedWeather).toHaveBeenCalledWith({
      lat: 37.5665,
      lon: 126.978,
    });
  });

  it("recommends the shade-first route in high heat", async () => {
    mockedWeather.mockResolvedValue({
      ...mildWeather,
      apparentTemperatureC: 33,
      uvIndex: 7,
    });
    mockedCalculate.mockResolvedValue(bundle);
    render(<App />);

    await screen.findByText("그늘 우선 경로를 추천해요");
    fireEvent.click(screen.getByRole("button", { name: "그늘 경로 찾기" }));
    const shadeRoute = await screen.findByRole("button", {
      name: "그늘우선 경로 선택",
    });
    expect(shadeRoute).toHaveTextContent("추천");
  });

  it("keeps route search usable when weather fails", async () => {
    mockedWeather.mockRejectedValue(new Error("WEATHER_LOAD_FAILED"));
    mockedCalculate.mockResolvedValue(bundle);
    render(<App />);

    await screen.findByText("날씨 연결 없이도 경로를 찾을 수 있어요");
    const searchButton = screen.getByRole("button", { name: "그늘 경로 찾기" });
    expect(searchButton).toBeEnabled();
    fireEvent.click(searchButton);
    expect(
      await screen.findByRole("heading", { name: /에서.*까지/ }),
    ).toBeVisible();
  });

  it("records a conversion only after a route result is ready", async () => {
    mockedCalculate.mockResolvedValue(bundle);
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "그늘 경로 찾기" }));

    await screen.findByRole("heading", { name: /에서.*까지/ });
    expect(mockedTrackRouteResultView).toHaveBeenCalledOnce();
  });

  it("does not record a conversion when route calculation fails", async () => {
    mockedCalculate.mockRejectedValue(new Error("ROUTE_NOT_FOUND"));
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "그늘 경로 찾기" }));

    await screen.findByText("가까운 지원 보행로를 찾지 못했어요");
    expect(mockedTrackRouteResultView).not.toHaveBeenCalled();
  });

  it("does not record a conversion for an aborted request that resolves later", async () => {
    let resolveRoute: ((value: RouteBundle) => void) | undefined;
    mockedCalculate.mockImplementation(
      () => new Promise<RouteBundle>((resolve) => (resolveRoute = resolve)),
    );
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "그늘 경로 찾기" }));
    expect(resolveRoute).toBeTypeOf("function");

    act(() => window.dispatchEvent(new Event("pagehide")));

    await act(async () => {
      resolveRoute?.(bundle);
      await Promise.resolve();
    });

    expect(mockedTrackRouteResultView).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("heading", { name: /에서.*까지/ }),
    ).not.toBeInTheDocument();
  });

  it("does not calculate with the previous place while a query is uncommitted", () => {
    render(<App />);
    const input = startInput();

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "강" } });
    const searchButton = screen.getByRole("button", { name: "그늘 경로 찾기" });
    expect(searchButton).toBeDisabled();
    expect(
      screen.getByText("검색 결과에서 장소를 선택해 주세요."),
    ).toBeVisible();

    fireEvent.blur(input, { relatedTarget: document.body });
    expect(input).toHaveValue("강");
    expect(searchButton).toBeDisabled();
  });

  it("loads Seoul stations and filters them by name", async () => {
    mockedPlaces.mockResolvedValue([
      { id: "city-hall", name: "시청", lat: 37.5657, lon: 126.9769 },
      { id: "jonggak", name: "종각", lat: 37.5702, lon: 126.9831 },
    ]);
    render(<App />);

    await waitFor(() => expect(mockedPlaces).toHaveBeenCalledOnce());
    choosePlace(startInput(), "시청역", "시청");
    choosePlace(goalInput(), "종각역", "종각");

    expect(startInput()).toHaveValue("시청");
    expect(goalInput()).toHaveValue("종각");
  });

  it("routes to a building selected by its road address", async () => {
    const tossPlace = {
      id: "osm-way-123",
      name: "토스플레이스",
      aliases: ["Toss Place"],
      address: "서울 강남구 테헤란로 142",
      kind: "office" as const,
      lat: 37.5007,
      lon: 127.0364,
    };
    mockedPlaces.mockResolvedValue([tossPlace]);
    mockedCalculate.mockResolvedValue({ ...bundle, goal: tossPlace });
    render(<App />);

    await waitFor(() => expect(mockedPlaces).toHaveBeenCalledOnce());
    choosePlace(goalInput(), "테헤란로 142", "토스플레이스");
    fireEvent.click(screen.getByRole("button", { name: "그늘 경로 찾기" }));

    await screen.findByRole("heading", { name: /에서.*까지/ });
    expect(mockedCalculate).toHaveBeenCalledWith(
      {
        start: expect.objectContaining({ id: "gangnam-11" }),
        goal: tossPlace,
        offsetMinutes: 0,
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("explains and retries a failed Seoul station index", async () => {
    mockedPlaces
      .mockRejectedValueOnce(new Error("PLACE_LOAD_FAILED"))
      .mockResolvedValueOnce([
        { id: "city-hall", name: "시청", lat: 37.5657, lon: 126.9769 },
      ]);
    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "서울 장소 목록을 불러오지 못했어요.",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "장소 목록 다시 불러오기" }),
    );

    await waitFor(() => expect(mockedPlaces).toHaveBeenCalledTimes(2));
    choosePlace(startInput(), "시청", "시청");
    expect(startInput()).toHaveValue("시청");
    expect(mockedPlaces).toHaveBeenCalledTimes(2);
  });

  it("uses an in-corridor current location as the route start", async () => {
    const currentPlace = {
      id: "current-location",
      name: "현재 위치",
      lat: 37.4998,
      lon: 127.031,
    } as const;
    mockedLocation.mockResolvedValue(currentPlace);
    mockedCalculate.mockResolvedValue({ ...bundle, start: currentPlace });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "현재 위치로 출발" }));

    await waitFor(() => expect(startInput()).toHaveValue("현재 위치"));
    expect(screen.getByRole("status")).toHaveTextContent(
      "현재 위치를 출발지로 설정했어요.",
    );

    fireEvent.click(screen.getByRole("button", { name: "그늘 경로 찾기" }));
    await screen.findByRole("heading", { name: /에서.*까지/ });
    expect(mockedCalculate).toHaveBeenCalledWith(
      {
        start: currentPlace,
        goal: bundle.goal,
        offsetMinutes: 0,
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("discards cached coordinates when the user returns to a preset", async () => {
    mockedLocation.mockResolvedValue({
      id: "current-location",
      name: "현재 위치",
      lat: 37.4998,
      lon: 127.031,
    });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "현재 위치로 출발" }));
    await waitFor(() => expect(startInput()).toHaveValue("현재 위치"));

    choosePlace(startInput(), "강남역 11번 출구", "강남역 11번 출구");

    expect(startInput()).toHaveValue("강남역 11번 출구");
  });

  it("discards an old current location when refresh fails", async () => {
    mockedLocation
      .mockResolvedValueOnce({
        id: "current-location",
        name: "현재 위치",
        lat: 37.4998,
        lon: 127.031,
      })
      .mockRejectedValueOnce(
        new CurrentLocationError("LOCATION_PERMISSION_DENIED"),
      );
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "현재 위치로 출발" }));
    await waitFor(() => expect(startInput()).toHaveValue("현재 위치"));

    fireEvent.click(screen.getByRole("button", { name: "현재 위치로 출발" }));

    await screen.findByRole("alert");
    expect(startInput()).toHaveValue("강남역 11번 출구");
  });

  it("keeps the preset start and explains a location outside Seoul", async () => {
    mockedLocation.mockRejectedValue(new CurrentLocationError("OUTSIDE_SEOUL"));
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "현재 위치로 출발" }));

    const locationAlert = await screen.findByRole("alert");
    expect(locationAlert).toHaveTextContent("위치는 정상적으로 확인했어요.");
    expect(locationAlert).toHaveTextContent(
      "현재 위치가 서울 밖이라 출발지로 사용할 수 없어요.",
    );
    expect(startInput()).toHaveValue("강남역 11번 출구");
  });

  it("keeps preset routing available after location permission denial", async () => {
    mockedLocation.mockRejectedValue(
      new CurrentLocationError("LOCATION_PERMISSION_DENIED"),
    );
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "현재 위치로 출발" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "위치 권한을 허용하면 현재 위치에서 출발할 수 있어요.",
    );
    expect(
      screen.getByRole("button", { name: "그늘 경로 찾기" }),
    ).toBeEnabled();
  });

  it("retries location after the user grants permission", async () => {
    const currentPlace = {
      id: "current-location",
      name: "현재 위치",
      lat: 37.4998,
      lon: 127.031,
    } as const;
    mockedLocation
      .mockRejectedValueOnce(
        new CurrentLocationError("LOCATION_PERMISSION_DENIED"),
      )
      .mockResolvedValueOnce(currentPlace);
    mockedPermissionRequest.mockResolvedValue(true);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "현재 위치로 출발" }));
    await screen.findByRole("alert");

    fireEvent.click(
      screen.getByRole("button", { name: "위치 권한 다시 요청" }),
    );

    await waitFor(() => expect(startInput()).toHaveValue("현재 위치"));
    expect(mockedPermissionRequest).toHaveBeenCalledOnce();
  });

  it("explains when the current location accuracy is too low", async () => {
    mockedLocation.mockRejectedValue(
      new CurrentLocationError("LOCATION_LOW_ACCURACY"),
    );
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "현재 위치로 출발" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "위치 오차가 커요.",
    );
  });

  it("keeps controls locked while reading current location", async () => {
    let resolveLocation:
      | ((value: {
          id: string;
          name: string;
          lat: number;
          lon: number;
        }) => void)
      | undefined;
    mockedLocation.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLocation = resolve;
        }),
    );
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "현재 위치로 출발" }));

    expect(
      screen.getByRole("button", { name: "위치를 확인하고 있어요" }),
    ).toBeDisabled();
    expect(startInput()).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "그늘 경로 찾기" }),
    ).toBeDisabled();

    await act(async () => {
      resolveLocation?.({
        id: "current-location",
        name: "현재 위치",
        lat: 37.4998,
        lon: 127.031,
      });
    });
  });

  it("calculates three routes and selects the balanced route by default", async () => {
    const scrollTo = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => undefined);
    mockedCalculate.mockResolvedValue(bundle);
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "그늘 경로 찾기" }));

    expect(
      await screen.findByRole("heading", { name: /에서.*까지/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "강남역 11번 출구에서 역삼역까지",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "출발지 검색" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "빠른길 경로 선택" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "균형 경로 선택" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("region", { name: "균형 경로 지도" }),
    ).toBeInTheDocument();
    expect(scrollTo).toHaveBeenCalledWith({
      top: 0,
      left: 0,
      behavior: "auto",
    });
    scrollTo.mockRestore();
  });

  it("locks route controls while a calculation is running", async () => {
    let resolveRoute: ((value: RouteBundle) => void) | undefined;
    mockedCalculate.mockImplementation(
      () => new Promise<RouteBundle>((resolve) => (resolveRoute = resolve)),
    );
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "그늘 경로 찾기" }));

    expect(
      screen.getByRole("button", { name: "그늘을 계산하고 있어요" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "30분 뒤" })).toBeDisabled();
    expect(startInput()).toBeDisabled();

    expect(resolveRoute).toBeTypeOf("function");
    await act(async () => {
      resolveRoute?.(bundle);
    });
    expect(
      await screen.findByRole("heading", { name: /에서.*까지/ }),
    ).toBeInTheDocument();
  });

  it("aborts an active route worker when the app unmounts", async () => {
    let routeSignal: AbortSignal | undefined;
    mockedCalculate.mockImplementation(
      (_request, options) =>
        new Promise<RouteBundle>(() => {
          routeSignal = options?.signal;
        }),
    );
    const { unmount } = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "그늘 경로 찾기" }));
    await waitFor(() => expect(routeSignal).toBeInstanceOf(AbortSignal));

    unmount();

    expect(routeSignal?.aborted).toBe(true);
  });

  it("aborts an active route worker when the WebView is hidden", async () => {
    let routeSignal: AbortSignal | undefined;
    mockedCalculate.mockImplementation(
      (_request, options) =>
        new Promise<RouteBundle>(() => {
          routeSignal = options?.signal;
        }),
    );
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "그늘 경로 찾기" }));
    await waitFor(() => expect(routeSignal).toBeInstanceOf(AbortSignal));

    act(() => window.dispatchEvent(new Event("pagehide")));

    expect(routeSignal?.aborted).toBe(true);
    expect(
      screen.getByRole("button", { name: "그늘 경로 찾기" }),
    ).toBeEnabled();
  });

  it("keeps a completed route visible when the WebView is hidden", async () => {
    mockedCalculate.mockResolvedValue(bundle);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "그늘 경로 찾기" }));
    await screen.findByRole("heading", { name: /에서.*까지/ });

    act(() => window.dispatchEvent(new Event("pagehide")));

    expect(
      screen.getByRole("heading", { name: /에서.*까지/ }),
    ).toBeInTheDocument();

    const visibilityState = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    visibilityState.mockRestore();

    expect(
      screen.getByRole("heading", { name: /에서.*까지/ }),
    ).toBeInTheDocument();
  });

  it("updates the highlighted map when another route is selected", async () => {
    mockedCalculate.mockResolvedValue(bundle);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "그늘 경로 찾기" }));
    await screen.findByRole("heading", { name: /에서.*까지/ });

    fireEvent.click(screen.getByRole("button", { name: "그늘우선 경로 선택" }));

    expect(
      screen.getByRole("button", { name: "그늘우선 경로 선택" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("region", { name: "그늘우선 경로 지도" }),
    ).toBeInTheDocument();
  });

  it("summarizes the selected route against the fastest one", async () => {
    mockedCalculate.mockResolvedValue(bundle);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "그늘 경로 찾기" }));
    await screen.findByRole("heading", { name: /에서.*까지/ });

    expect(routeSummaryText()).toBe(
      "균형은 빠른길보다 1분 더 걸리고, 예상 햇빛 노출은 1분 적어요.",
    );
    expect(
      screen.getByText("건물 데이터와 출발 시각을 기준으로 계산한 예상치예요."),
    ).toBeInTheDocument();
  });

  it("rewrites the summary when another route is selected", async () => {
    mockedCalculate.mockResolvedValue(bundle);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "그늘 경로 찾기" }));
    await screen.findByRole("heading", { name: /에서.*까지/ });

    fireEvent.click(screen.getByRole("button", { name: "그늘우선 경로 선택" }));

    expect(routeSummaryText()).toBe(
      "그늘우선은 빠른길보다 3분 더 걸리고, 예상 햇빛 노출은 2분 적어요.",
    );
  });

  it("states absolute exposure instead of comparing the fastest route to itself", async () => {
    mockedCalculate.mockResolvedValue(bundle);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "그늘 경로 찾기" }));
    await screen.findByRole("heading", { name: /에서.*까지/ });

    fireEvent.click(screen.getByRole("button", { name: "빠른길 경로 선택" }));

    expect(routeSummaryText()).toBe("빠른길의 예상 햇빛 노출은 8분이에요.");
    expect(routeSummaryText()).not.toContain("빠른길보다");
  });

  it("keeps the map and route choices visible when the result sheet is dragged down", async () => {
    mockedCalculate.mockResolvedValue(bundle);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "그늘 경로 찾기" }));
    await screen.findByRole("heading", { name: /에서.*까지/ });

    const handle = screen.getByRole("button", { name: "경로 정보 접기" });
    const sheet = screen.getByLabelText("경로 정보");
    mockResultSheetLayout(sheet);
    fireEvent.pointerDown(handle, {
      button: 0,
      clientY: 100,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerMove(handle, {
      button: 0,
      clientY: 132,
      isPrimary: true,
      pointerId: 1,
    });

    expect(sheet).toHaveClass("is-dragging");
    expect(sheet).toHaveStyle({
      "--result-sheet-drag-height": "468px",
    });

    fireEvent.pointerUp(handle, {
      button: 0,
      clientY: 148,
      isPrimary: true,
      pointerId: 1,
    });

    expect(sheet).toHaveClass("is-collapsed");
    expect(sheet).toHaveStyle({
      "--result-sheet-peek-height": "312px",
    });
    expect(
      screen.getByRole("button", { name: "경로 정보 펼치기" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.getByRole("region", { name: "균형 경로 지도" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "빠른길 경로 선택" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "균형 경로 선택" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "그늘우선 경로 선택" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "출발 시각" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "그늘우선 경로 선택" }));
    expect(
      screen.getByRole("region", { name: "그늘우선 경로 지도" }),
    ).toBeInTheDocument();
  });

  it("restores the result details when the collapsed sheet is dragged up", async () => {
    mockedCalculate.mockResolvedValue(bundle);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "그늘 경로 찾기" }));
    await screen.findByRole("heading", { name: /에서.*까지/ });

    const expandedHandle = screen.getByRole("button", {
      name: "경로 정보 접기",
    });
    fireEvent.pointerDown(expandedHandle, {
      button: 0,
      clientY: 100,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerUp(expandedHandle, {
      button: 0,
      clientY: 148,
      isPrimary: true,
      pointerId: 1,
    });

    const collapsedHandle = screen.getByRole("button", {
      name: "경로 정보 펼치기",
    });
    fireEvent.pointerDown(collapsedHandle, {
      button: 0,
      clientY: 148,
      isPrimary: true,
      pointerId: 2,
    });
    fireEvent.pointerUp(collapsedHandle, {
      button: 0,
      clientY: 100,
      isPrimary: true,
      pointerId: 2,
    });

    expect(screen.getByLabelText("경로 정보")).not.toHaveClass("is-collapsed");
    expect(
      screen.getByRole("button", { name: "경로 정보 접기" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("group", { name: "출발 시각" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "상세 경로" }),
    ).toBeInTheDocument();
  });

  it("shows friendly walking directions and updates them with the route mode", async () => {
    mockedCalculate.mockResolvedValue(bundle);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "그늘 경로 찾기" }));

    expect(
      await screen.findByRole("heading", { name: "상세 경로" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("도보 경로 안내")).toBeInTheDocument();
    expect(screen.getByText("역삼역에 도착")).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "균형 경로, 13분, 2단계" }),
    ).toHaveTextContent("예상 그늘 43%");
    fireEvent.click(screen.getByRole("button", { name: "상세 경로 접기" }));
    expect(screen.queryByLabelText("도보 경로 안내")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "그늘우선 경로 선택" }));
    expect(
      screen.getByRole("status", { name: "그늘우선 경로, 15분, 2단계" }),
    ).toHaveTextContent("예상 그늘 60%");
  });

  it("shows a retry action after a data loading error", async () => {
    mockedCalculate
      .mockRejectedValueOnce(new Error("LOAD_FAILED"))
      .mockResolvedValueOnce(bundle);
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "그늘 경로 찾기" }));
    expect(
      await screen.findByText("경로를 불러오지 못했어요"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(
      await screen.findByRole("heading", { name: /에서.*까지/ }),
    ).toBeInTheDocument();
    expect(mockedCalculate).toHaveBeenCalledTimes(2);
  });

  it("explains the three-kilometer route limit", async () => {
    mockedCalculate.mockRejectedValue(new Error("ROUTE_TOO_LONG"));
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "그늘 경로 찾기" }));

    expect(
      await screen.findByText("3km 이내 경로만 지원해요"),
    ).toBeInTheDocument();
  });

  it("explains when route data exceeds the WebView work budget", async () => {
    mockedCalculate.mockRejectedValue(new Error("ROUTE_DATA_TOO_COMPLEX"));
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "그늘 경로 찾기" }));

    expect(
      await screen.findByText("이 지역의 경로 데이터가 너무 복잡해요"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("더 가까운 장소를 선택해 다시 시도해 주세요."),
    ).toBeInTheDocument();
  });

  it("explains when the current start is already at the goal", async () => {
    mockedCalculate.mockRejectedValue(new Error("ALREADY_NEAR_GOAL"));
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "그늘 경로 찾기" }));

    expect(await screen.findByText("이미 도착지 근처예요")).toBeInTheDocument();
    expect(
      screen.queryByText("데이터 연결을 확인하고 다시 시도해 주세요."),
    ).not.toBeInTheDocument();
  });

  it("explains when no supported footpath is close enough", async () => {
    mockedCalculate.mockRejectedValue(new Error("SNAP_FAILED"));
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "그늘 경로 찾기" }));

    expect(
      await screen.findByText("가까운 지원 보행로를 찾지 못했어요"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "가까운 장소를 선택하거나 현재 위치를 다시 확인해 주세요.",
      ),
    ).toBeInTheDocument();
  });

  it("clears stale routes when a place changes", async () => {
    mockedCalculate.mockResolvedValue(bundle);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "그늘 경로 찾기" }));
    await screen.findByRole("heading", { name: /에서.*까지/ });

    fireEvent.click(screen.getByRole("button", { name: "검색으로 돌아가기" }));

    choosePlace(startInput(), "역삼역", "역삼역");

    expect(
      screen.queryByRole("heading", { name: /에서.*까지/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "출발지와 도착지를 다르게 선택해 주세요.",
    );
    expect(startInput()).toHaveAttribute(
      "aria-describedby",
      "same-place-error",
    );
    expect(goalInput()).toHaveAttribute("aria-invalid", "true");
  });

  it("shows zero minutes when a route has no sunlight exposure", async () => {
    const nightBundle = {
      ...bundle,
      routes: bundle.routes.map((item) => ({
        ...item,
        sunSec: 0,
        shadeRatio: 1,
      })),
    };
    mockedCalculate.mockResolvedValue(nightBundle);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "그늘 경로 찾기" }));

    await screen.findByRole("heading", { name: /에서.*까지/ });
    const sunRow = screen.getByRole("row", { name: /^햇빛/ });
    expect(sunRow).toHaveTextContent(/^햇빛0분0분0분$/);
  });

  it("recalculates results when the departure time changes", async () => {
    mockedCalculate.mockResolvedValue(bundle);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "그늘 경로 찾기" }));
    await screen.findByRole("heading", { name: /에서.*까지/ });

    fireEvent.click(screen.getByRole("button", { name: "그늘우선 경로 선택" }));
    fireEvent.click(screen.getByRole("button", { name: "30분 뒤" }));

    await waitFor(() => expect(mockedCalculate).toHaveBeenCalledTimes(2));
    expect(mockedCalculate.mock.calls[1][0].offsetMinutes).toBe(30);
    expect(
      screen.getByRole("button", { name: "그늘우선 경로 선택" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("returns to the filled search screen without recalculating", async () => {
    mockedCalculate.mockResolvedValue(bundle);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "그늘 경로 찾기" }));
    await screen.findByRole("heading", {
      name: "강남역 11번 출구에서 역삼역까지",
    });

    fireEvent.click(screen.getByRole("button", { name: "검색으로 돌아가기" }));

    expect(startInput()).toHaveValue("강남역 11번 출구");
    expect(goalInput()).toHaveValue("역삼역");
    expect(
      screen.queryByRole("heading", { name: /에서.*까지/ }),
    ).not.toBeInTheDocument();
    expect(mockedCalculate).toHaveBeenCalledOnce();
  });

  it("does not render the feedback widget when the webhook env is empty", async () => {
    mockedCalculate.mockResolvedValue(bundle);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "그늘 경로 찾기" }));
    await screen.findByRole("heading", { name: /에서.*까지/ });

    expect(
      screen.queryByRole("heading", {
        name: "이 경로가 실제와 얼마나 맞았어요?",
      }),
    ).not.toBeInTheDocument();
  });

  it("renders the feedback widget and preserves route interactions when the webhook env is set", async () => {
    vi.stubEnv("VITE_FEEDBACK_WEBHOOK_URL", "https://example.com/hook");
    mockedCalculate.mockResolvedValue(bundle);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "그늘 경로 찾기" }));

    await screen.findByRole("heading", { name: /에서.*까지/ });
    expect(
      screen.getByRole("heading", {
        name: "이 경로가 실제와 얼마나 맞았어요?",
      }),
    ).toBeInTheDocument();

    // Mode switching still works next to the widget.
    fireEvent.click(screen.getByRole("button", { name: "그늘우선 경로 선택" }));
    expect(
      screen.getByRole("button", { name: "그늘우선 경로 선택" }),
    ).toHaveAttribute("aria-pressed", "true");

    // Back button still routes to the search screen.
    fireEvent.click(screen.getByRole("button", { name: "검색으로 돌아가기" }));
    expect(startInput()).toHaveValue("강남역 11번 출구");
    expect(
      screen.queryByRole("heading", {
        name: "이 경로가 실제와 얼마나 맞았어요?",
      }),
    ).not.toBeInTheDocument();
  });
});
