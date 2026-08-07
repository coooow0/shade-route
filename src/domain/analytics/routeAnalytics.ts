import { Analytics } from "@apps-in-toss/web-framework";
import type { Satisfaction } from "../feedback/feedbackClient";
import type { RouteMode } from "../routing/types";

export type RouteSearchTrigger =
  | "submit"
  | "retry"
  | "departure_time_change";

export type RouteSearchFailureReason =
  | "near_goal"
  | "too_long"
  | "outside_seoul"
  | "complex_data"
  | "off_network"
  | "generic";

interface RouteSearchStartEvent {
  readonly trigger: RouteSearchTrigger;
  readonly offsetMinutes: number;
}

function safelyTrack(send: () => Promise<void> | undefined): void {
  try {
    void send()?.catch(() => undefined);
  } catch {
    // Optional analytics must never interrupt the user's route flow.
  }
}

export function trackRouteSearchStart({
  trigger,
  offsetMinutes,
}: RouteSearchStartEvent): void {
  safelyTrack(() =>
    Analytics.click({
      log_name: "route_search_start",
      trigger,
      offset_minutes: offsetMinutes,
    }),
  );
}

export function trackRouteSearchFailure(
  reason: RouteSearchFailureReason,
): void {
  safelyTrack(() =>
    Analytics.impression({
      log_name: "route_search_failure",
      reason,
    }),
  );
}

export function trackRouteResultView(): void {
  safelyTrack(() =>
    Analytics.screen({
      log_name: "route_result_view",
    }),
  );
}

export function trackRouteModeSelect(routeMode: RouteMode): void {
  safelyTrack(() =>
    Analytics.click({
      log_name: "route_mode_select",
      route_mode: routeMode,
    }),
  );
}

export function trackRouteFeedbackImpression(routeMode: RouteMode): void {
  safelyTrack(() =>
    Analytics.impression({
      log_name: "route_feedback_impression",
      route_mode: routeMode,
    }),
  );
}

export function trackRouteFeedbackSelect(
  routeMode: RouteMode,
  satisfaction: Satisfaction,
): void {
  safelyTrack(() =>
    Analytics.click({
      log_name: "route_feedback_select",
      route_mode: routeMode,
      satisfaction,
    }),
  );
}

export function trackRouteFeedbackSubmit(
  routeMode: RouteMode,
  satisfaction: Satisfaction,
): void {
  safelyTrack(() =>
    Analytics.click({
      log_name: "route_feedback_submit",
      route_mode: routeMode,
      satisfaction,
    }),
  );
}
