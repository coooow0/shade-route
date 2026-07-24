import { describe, expect, it } from "vitest";
import {
  isRouteWorkerRequest,
  safeRouteWorkerError,
} from "./routeWorkerProtocol";

const validRequest = {
  schema: 1,
  request: {
    start: { id: "start", name: "출발", lat: 37.5, lon: 127.02 },
    goal: { id: "goal", name: "도착", lat: 37.51, lon: 127.03 },
    offsetMinutes: 30,
  },
} as const;

describe("route worker protocol", () => {
  it("accepts the bounded protocol request", () => {
    expect(isRouteWorkerRequest(validRequest)).toBe(true);
  });

  it.each([
    null,
    { ...validRequest, schema: 2 },
    { schema: 1, request: null },
    {
      ...validRequest,
      request: { ...validRequest.request, offsetMinutes: 15 },
    },
    {
      ...validRequest,
      request: {
        ...validRequest.request,
        start: { ...validRequest.request.start, lat: Number.NaN },
      },
    },
    {
      ...validRequest,
      request: {
        ...validRequest.request,
        goal: { ...validRequest.request.goal, id: "x".repeat(161) },
      },
    },
  ])("rejects malformed or out-of-budget worker input", (message) => {
    expect(isRouteWorkerRequest(message)).toBe(false);
  });

  it("returns allowlisted domain errors without exposing unexpected details", () => {
    expect(safeRouteWorkerError(new Error("ROUTE_TOO_LONG"))).toBe(
      "ROUTE_TOO_LONG",
    );
    expect(safeRouteWorkerError(new Error("secret stack detail"))).toBe(
      "ROUTE_CALCULATION_FAILED",
    );
    expect(safeRouteWorkerError("ROUTE_TOO_LONG")).toBe(
      "ROUTE_CALCULATION_FAILED",
    );
  });
});
