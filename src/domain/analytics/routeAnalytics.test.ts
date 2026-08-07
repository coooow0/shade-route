import { Analytics } from "@apps-in-toss/web-framework";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  trackRouteFeedbackImpression,
  trackRouteFeedbackSelect,
  trackRouteFeedbackSubmit,
  trackRouteModeSelect,
  trackRouteResultView,
  trackRouteSearchFailure,
  trackRouteSearchStart,
} from "./routeAnalytics";

vi.mock("@apps-in-toss/web-framework", () => ({
  Analytics: {
    click: vi.fn(),
    impression: vi.fn(),
    screen: vi.fn(),
  },
}));

const mockedClick = vi.mocked(Analytics.click);
const mockedImpression = vi.mocked(Analytics.impression);
const mockedScreen = vi.mocked(Analytics.screen);

describe("route analytics", () => {
  beforeEach(() => {
    mockedClick.mockReset();
    mockedImpression.mockReset();
    mockedScreen.mockReset();
  });

  it("records a route search start without place or coordinate data", () => {
    trackRouteSearchStart({ trigger: "submit", offsetMinutes: 30 });

    expect(mockedClick).toHaveBeenCalledExactlyOnceWith({
      log_name: "route_search_start",
      trigger: "submit",
      offset_minutes: 30,
    });
  });

  it("records only a bounded route search failure reason", () => {
    trackRouteSearchFailure("off_network");

    expect(mockedImpression).toHaveBeenCalledExactlyOnceWith({
      log_name: "route_search_failure",
      reason: "off_network",
    });
  });

  it("records only the non-sensitive route result event name", () => {
    trackRouteResultView();

    expect(mockedScreen).toHaveBeenCalledExactlyOnceWith({
      log_name: "route_result_view",
    });
  });

  it("records route-mode selection from the comparison table", () => {
    trackRouteModeSelect("maxShade");

    expect(mockedClick).toHaveBeenCalledExactlyOnceWith({
      log_name: "route_mode_select",
      route_mode: "maxShade",
    });
  });

  it("records feedback impression, selection, and submission events", () => {
    trackRouteFeedbackImpression("balanced");
    trackRouteFeedbackSelect("balanced", "mid");
    trackRouteFeedbackSubmit("balanced", "mid");

    expect(mockedImpression).toHaveBeenCalledExactlyOnceWith({
      log_name: "route_feedback_impression",
      route_mode: "balanced",
    });
    expect(mockedClick).toHaveBeenNthCalledWith(1, {
      log_name: "route_feedback_select",
      route_mode: "balanced",
      satisfaction: "mid",
    });
    expect(mockedClick).toHaveBeenNthCalledWith(2, {
      log_name: "route_feedback_submit",
      route_mode: "balanced",
      satisfaction: "mid",
    });
  });

  it("does not interrupt route rendering when analytics throws", () => {
    mockedScreen.mockImplementation(() => {
      throw new Error("ANALYTICS_UNAVAILABLE");
    });

    expect(() => trackRouteResultView()).not.toThrow();
  });

  it("handles a rejected analytics request without an unhandled rejection", async () => {
    mockedScreen.mockRejectedValue(new Error("ANALYTICS_UNAVAILABLE"));

    trackRouteResultView();
    await Promise.resolve();

    expect(mockedScreen).toHaveBeenCalledOnce();
  });

  it("does not interrupt clicks when analytics throws", () => {
    mockedClick.mockImplementation(() => {
      throw new Error("ANALYTICS_UNAVAILABLE");
    });

    expect(() => trackRouteModeSelect("shortest")).not.toThrow();
  });

  it("handles a rejected impression without an unhandled rejection", async () => {
    mockedImpression.mockRejectedValue(new Error("ANALYTICS_UNAVAILABLE"));

    trackRouteSearchFailure("generic");
    await Promise.resolve();

    expect(mockedImpression).toHaveBeenCalledOnce();
  });
});
