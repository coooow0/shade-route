import { Analytics } from "@apps-in-toss/web-framework";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { trackRouteResultView } from "./routeAnalytics";

vi.mock("@apps-in-toss/web-framework", () => ({
  Analytics: {
    screen: vi.fn(),
  },
}));

const mockedScreen = vi.mocked(Analytics.screen);

describe("route analytics", () => {
  beforeEach(() => {
    mockedScreen.mockReset();
  });

  it("records only the non-sensitive route result event name", () => {
    trackRouteResultView();

    expect(mockedScreen).toHaveBeenCalledExactlyOnceWith({
      log_name: "route_result_view",
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
});
