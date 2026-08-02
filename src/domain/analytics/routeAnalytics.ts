import { Analytics } from "@apps-in-toss/web-framework";

export function trackRouteResultView(): void {
  try {
    void Analytics.screen({
      log_name: "route_result_view",
    })?.catch(() => undefined);
  } catch {
    // Optional analytics must never block a successful route result.
  }
}
