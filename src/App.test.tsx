import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { loadSeoulPlaces } from "./domain/places/loadSeoulPlaces";
import {
  CurrentLocationError,
  requestCurrentLocationPermission,
  resolveCurrentPlace,
} from "./domain/location/currentLocation";
import { calculateRouteBundleForPlaces } from "./domain/routing/routeService";
import { loadCurrentWeather } from "./domain/weather/currentWeather";
import type { RouteBundle, RouteResult } from "./domain/routing/types";

vi.mock("./domain/routing/routeService", async () => {
  const actual = await vi.importActual<
    typeof import("./domain/routing/routeService")
  >("./domain/routing/routeService");
  return { ...actual, calculateRouteBundleForPlaces: vi.fn() };
});

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

describe("App", () => {
  beforeEach(() => {
    mockedCalculate.mockReset();
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
      await screen.findByRole("heading", { name: "경로 비교" }),
    ).toBeVisible();
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

    await screen.findByRole("heading", { name: "경로 비교" });
    expect(mockedCalculate).toHaveBeenCalledWith({
      start: expect.objectContaining({ id: "gangnam-11" }),
      goal: tossPlace,
      offsetMinutes: 0,
    });
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
    await screen.findByRole("heading", { name: "경로 비교" });
    expect(mockedCalculate).toHaveBeenCalledWith({
      start: currentPlace,
      goal: bundle.goal,
      offsetMinutes: 0,
    });
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

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "현재 위치는 서울 밖이에요. 선택한 출발지를 유지했어요.",
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
      await screen.findByRole("heading", { name: "경로 비교" }),
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
      await screen.findByRole("heading", { name: "경로 비교" }),
    ).toBeInTheDocument();
  });

  it("updates the highlighted map when another route is selected", async () => {
    mockedCalculate.mockResolvedValue(bundle);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "그늘 경로 찾기" }));
    await screen.findByRole("heading", { name: "경로 비교" });

    fireEvent.click(screen.getByRole("button", { name: "그늘우선 경로 선택" }));

    expect(
      screen.getByRole("button", { name: "그늘우선 경로 선택" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("region", { name: "그늘우선 경로 지도" }),
    ).toBeInTheDocument();
  });

  it("shows friendly walking directions and updates them with the route mode", async () => {
    mockedCalculate.mockResolvedValue(bundle);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "그늘 경로 찾기" }));

    expect(
      await screen.findByRole("heading", { name: "상세 경로" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("도보 경로 안내")).not.toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "상세 경로 2단계 보기" }),
    );
    expect(screen.getByText("역삼역에 도착")).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "균형 경로, 13분, 2단계" }),
    ).toHaveTextContent("예상 그늘 43%");

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
      await screen.findByRole("heading", { name: "경로 비교" }),
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
    await screen.findByRole("heading", { name: "경로 비교" });

    fireEvent.click(screen.getByRole("button", { name: "출발지·도착지 수정" }));

    choosePlace(startInput(), "역삼역", "역삼역");

    expect(
      screen.queryByRole("heading", { name: "경로 비교" }),
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

    await screen.findByRole("heading", { name: "경로 비교" });
    expect(screen.getAllByText(/햇빛 0분/).length).toBeGreaterThan(0);
  });

  it("recalculates results when the departure time changes", async () => {
    mockedCalculate.mockResolvedValue(bundle);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "그늘 경로 찾기" }));
    await screen.findByRole("heading", { name: "경로 비교" });

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

    fireEvent.click(screen.getByRole("button", { name: "출발지·도착지 수정" }));

    expect(startInput()).toHaveValue("강남역 11번 출구");
    expect(goalInput()).toHaveValue("역삼역");
    expect(
      screen.queryByRole("heading", { name: "경로 비교" }),
    ).not.toBeInTheDocument();
    expect(mockedCalculate).toHaveBeenCalledOnce();
  });
});
