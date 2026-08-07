import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RouteFeedback from "./RouteFeedback";
import { APP_VERSION } from "../appVersion";
import {
  trackRouteFeedbackImpression,
  trackRouteFeedbackSelect,
  trackRouteFeedbackSubmit,
} from "../domain/analytics/routeAnalytics";
import type { RouteResult } from "../domain/routing/types";

vi.mock("../domain/analytics/routeAnalytics", () => ({
  trackRouteFeedbackImpression: vi.fn(),
  trackRouteFeedbackSelect: vi.fn(),
  trackRouteFeedbackSubmit: vi.fn(),
}));

const mockedTrackImpression = vi.mocked(trackRouteFeedbackImpression);
const mockedTrackSelect = vi.mocked(trackRouteFeedbackSelect);
const mockedTrackSubmit = vi.mocked(trackRouteFeedbackSubmit);

const route: RouteResult = {
  mode: "balanced",
  label: "균형",
  pathKey: "balanced-key",
  timeSec: 720,
  lengthM: 880,
  sunSec: 240,
  shadeRatio: 0.62,
  segments: [],
};

const REQUESTED_AT = "2026-07-25T08:00:00.000Z";
const WEBHOOK = "https://example.com/webhook";
let intersectionCallback: IntersectionObserverCallback | null = null;

class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly thresholds = [0];

  constructor(callback: IntersectionObserverCallback) {
    intersectionCallback = callback;
  }

  disconnect = vi.fn();
  observe = vi.fn();
  takeRecords = () => [];
  unobserve = vi.fn();
}

function revealFeedback(): void {
  const callback = intersectionCallback;
  const target = screen
    .getByRole("heading", { name: "이 경로가 실제와 얼마나 맞았어요?" })
    .closest("section");
  if (!callback || !target) throw new Error("Missing feedback observer");
  act(() => {
    callback(
      [
        {
          boundingClientRect: target.getBoundingClientRect(),
          intersectionRatio: 1,
          intersectionRect: target.getBoundingClientRect(),
          isIntersecting: true,
          rootBounds: null,
          target,
          time: 0,
        },
      ],
      {} as IntersectionObserver,
    );
  });
}

function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

describe("RouteFeedback", () => {
  beforeEach(() => {
    vi.useRealTimers();
    intersectionCallback = null;
    mockedTrackImpression.mockReset();
    mockedTrackSelect.mockReset();
    mockedTrackSubmit.mockReset();
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  });

  it("initially shows only the three compact satisfaction choices", () => {
    const onDetailOpen = vi.fn();

    render(
      <RouteFeedback
        route={route}
        requestedAt={REQUESTED_AT}
        webhookUrl={WEBHOOK}
        storage={makeStorage()}
        onDetailOpen={onDetailOpen}
      />,
    );

    const choices = within(
      screen.getByRole("group", { name: "정확도 만족도" }),
    ).getAllByRole("button");
    expect(choices.map((choice) => choice.textContent)).toEqual([
      "좋음",
      "보통",
      "나쁨",
    ]);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "보내기" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "취소" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "보통" }));

    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "보내기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "취소" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "보통" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(onDetailOpen).toHaveBeenCalledOnce();
  });

  it("records the prompt only once when it actually becomes visible", () => {
    render(
      <RouteFeedback
        route={route}
        requestedAt={REQUESTED_AT}
        webhookUrl={WEBHOOK}
        storage={makeStorage()}
      />,
    );

    expect(mockedTrackImpression).not.toHaveBeenCalled();
    revealFeedback();
    revealFeedback();

    expect(mockedTrackImpression).toHaveBeenCalledExactlyOnceWith("balanced");
  });

  it("records a newly selected route prompt separately", () => {
    const storage = makeStorage();
    const { rerender } = render(
      <RouteFeedback
        route={route}
        requestedAt={REQUESTED_AT}
        webhookUrl={WEBHOOK}
        storage={storage}
      />,
    );
    revealFeedback();

    rerender(
      <RouteFeedback
        route={{ ...route, mode: "maxShade", pathKey: "shade-key" }}
        requestedAt={REQUESTED_AT}
        webhookUrl={WEBHOOK}
        storage={storage}
      />,
    );

    expect(mockedTrackImpression).toHaveBeenCalledTimes(1);
    revealFeedback();
    expect(mockedTrackImpression).toHaveBeenNthCalledWith(2, "maxShade");
  });

  it("records satisfaction changes and successful submission", async () => {
    const submit = vi.fn().mockResolvedValue(undefined);

    render(
      <RouteFeedback
        route={route}
        requestedAt={REQUESTED_AT}
        webhookUrl={WEBHOOK}
        submit={submit}
        storage={makeStorage()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "나쁨" }));
    fireEvent.click(screen.getByRole("button", { name: "나쁨" }));
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));

    expect(mockedTrackSelect).toHaveBeenCalledExactlyOnceWith(
      "balanced",
      "bad",
    );
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(mockedTrackSubmit).toHaveBeenCalledExactlyOnceWith(
      "balanced",
      "bad",
    );
  });

  it("resets a draft when the same path is recalculated", () => {
    const storage = makeStorage();
    const { rerender } = render(
      <RouteFeedback
        route={route}
        requestedAt={REQUESTED_AT}
        webhookUrl={WEBHOOK}
        storage={storage}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "나쁨" }));
    fireEvent.change(screen.getByLabelText(/무엇이 달랐나요/), {
      target: { value: "이전 검색의 메모" },
    });

    rerender(
      <RouteFeedback
        route={route}
        requestedAt="2026-07-25T08:30:00.000Z"
        webhookUrl={WEBHOOK}
        storage={storage}
      />,
    );

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "나쁨" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("collects satisfaction, memo, and wanted-city then submits with route metrics", async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    const storage = makeStorage();

    render(
      <RouteFeedback
        route={route}
        requestedAt={REQUESTED_AT}
        webhookUrl={WEBHOOK}
        submit={submit}
        storage={storage}
        now={() => new Date("2026-07-25T08:00:12.000Z")}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /좋음/ }));
    fireEvent.change(screen.getByLabelText(/무엇이 달랐나요/), {
      target: { value: "  오후엔 그늘이 훨씬 많았어요  " },
    });
    fireEvent.change(screen.getByLabelText(/다른 도시도 원해요/), {
      target: { value: "부산" },
    });
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit).toHaveBeenCalledWith(
      {
        satisfaction: "good",
        memo: "오후엔 그늘이 훨씬 많았어요",
        wantedCity: "부산",
        routeMode: "balanced",
        timeSec: 720,
        lengthM: 880,
        sunSec: 240,
        shadeRatio: 0.62,
        requestedAt: REQUESTED_AT,
        submittedAt: "2026-07-25T08:00:12.000Z",
        appVersion: APP_VERSION,
      },
      { webhookUrl: WEBHOOK },
    );
    expect(await screen.findByText(/피드백 고마워요/)).toBeInTheDocument();
    expect(
      storage.getItem(`shade-route:feedback:${route.pathKey}`),
    ).toBeTruthy();
  });

  it("submits without optional fields when the user leaves them blank", async () => {
    const submit = vi.fn().mockResolvedValue(undefined);

    render(
      <RouteFeedback
        route={route}
        requestedAt={REQUESTED_AT}
        webhookUrl={WEBHOOK}
        submit={submit}
        storage={makeStorage()}
        now={() => new Date("2026-07-25T08:00:12.000Z")}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /나쁨/ }));
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    const submission = submit.mock.calls[0][0];
    expect(submission.satisfaction).toBe("bad");
    expect(submission.memo).toBeUndefined();
    expect(submission.wantedCity).toBeUndefined();
  });

  it("skips the form entirely for a route already submitted", () => {
    const submit = vi.fn();
    const storage = makeStorage();
    storage.setItem(
      `shade-route:feedback:${route.pathKey}`,
      "2026-07-24T09:00:00.000Z",
    );

    render(
      <RouteFeedback
        route={route}
        requestedAt={REQUESTED_AT}
        webhookUrl={WEBHOOK}
        submit={submit}
        storage={storage}
      />,
    );

    expect(screen.getByText(/피드백 고마워요/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /좋음/ }),
    ).not.toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
    expect(mockedTrackImpression).not.toHaveBeenCalled();
  });

  it("shows an inline error and allows retry when the submission fails", async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new Error("FEEDBACK_SUBMIT_FAILED"))
      .mockResolvedValueOnce(undefined);

    render(
      <RouteFeedback
        route={route}
        requestedAt={REQUESTED_AT}
        webhookUrl={WEBHOOK}
        submit={submit}
        storage={makeStorage()}
        now={() => new Date("2026-07-25T08:00:12.000Z")}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /보통/ }));
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "피드백을 보내지 못했어요",
    );
    expect(mockedTrackSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(mockedTrackSubmit).toHaveBeenCalledOnce();
    expect(await screen.findByText(/피드백 고마워요/)).toBeInTheDocument();
  });

  it("still submits when getItem/setItem are missing (broken storage)", async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    const brokenStorage = {} as unknown as Storage;

    render(
      <RouteFeedback
        route={route}
        requestedAt={REQUESTED_AT}
        webhookUrl={WEBHOOK}
        submit={submit}
        storage={brokenStorage}
        now={() => new Date("2026-07-25T08:00:12.000Z")}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /좋음/ }));
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(await screen.findByText(/피드백 고마워요/)).toBeInTheDocument();
  });

  it("keeps working when setItem throws (quota exceeded)", async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    const throwingStorage: Storage = {
      get length() {
        return 0;
      },
      clear: () => undefined,
      getItem: () => null,
      key: () => null,
      removeItem: () => undefined,
      setItem: () => {
        throw new DOMException("quota exceeded", "QuotaExceededError");
      },
    };

    render(
      <RouteFeedback
        route={route}
        requestedAt={REQUESTED_AT}
        webhookUrl={WEBHOOK}
        submit={submit}
        storage={throwingStorage}
        now={() => new Date("2026-07-25T08:00:12.000Z")}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /보통/ }));
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(await screen.findByText(/피드백 고마워요/)).toBeInTheDocument();
  });

  it("hides the detail form when the user cancels", () => {
    const submit = vi.fn();

    render(
      <RouteFeedback
        route={route}
        requestedAt={REQUESTED_AT}
        webhookUrl={WEBHOOK}
        submit={submit}
        storage={makeStorage()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /좋음/ }));
    expect(screen.getByLabelText(/무엇이 달랐나요/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.queryByLabelText(/무엇이 달랐나요/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "보내기" }),
    ).not.toBeInTheDocument();
  });
});
