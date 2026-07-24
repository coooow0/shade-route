import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calculateRouteBundleForPlaces,
  type RouteWorkerLike,
} from "./routeWorkerClient";
import type { RouteBundle, RoutePlacesRequest } from "./types";

const request: RoutePlacesRequest = {
  start: { id: "start", name: "출발", lat: 37.5, lon: 127.02 },
  goal: { id: "goal", name: "도착", lat: 37.51, lon: 127.03 },
  offsetMinutes: 0,
};

const bundle: RouteBundle = {
  requestedAt: "2026-07-15T00:00:00.000Z",
  start: request.start,
  goal: request.goal,
  routes: [
    {
      mode: "shortest",
      label: "빠른길",
      pathKey: "1",
      timeSec: 60,
      lengthM: 80,
      sunSec: 30,
      shadeRatio: 0.5,
      segments: [
        {
          from: request.start,
          to: request.goal,
          shadeRatio: 0.5,
          covered: false,
        },
      ],
    },
    {
      mode: "balanced",
      label: "균형",
      pathKey: "1",
      timeSec: 60,
      lengthM: 80,
      sunSec: 30,
      shadeRatio: 0.5,
      segments: [
        {
          from: request.start,
          to: request.goal,
          shadeRatio: 0.5,
          covered: false,
        },
      ],
    },
    {
      mode: "maxShade",
      label: "그늘우선",
      pathKey: "1",
      timeSec: 60,
      lengthM: 80,
      sunSec: 30,
      shadeRatio: 0.5,
      segments: [
        {
          from: request.start,
          to: request.goal,
          shadeRatio: 0.5,
          covered: false,
        },
      ],
    },
  ],
};

class FakeWorker implements RouteWorkerLike {
  readonly posted: unknown[] = [];
  terminated = false;
  private readonly listeners = new Map<string, Set<EventListener>>();

  postMessage(message: unknown) {
    this.posted.push(message);
  }

  addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener);
  }

  terminate() {
    this.terminated = true;
  }

  emitMessage(data: unknown) {
    const event = new MessageEvent("message", { data });
    for (const listener of this.listeners.get("message") ?? []) listener(event);
  }

  emitError() {
    const event = new Event("error");
    for (const listener of this.listeners.get("error") ?? []) listener(event);
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("route worker client", () => {
  it("resolves only a valid bounded worker result and terminates the worker", async () => {
    const worker = new FakeWorker();
    const result = calculateRouteBundleForPlaces(request, {
      workerFactory: () => worker,
    });

    expect(worker.posted).toEqual([{ schema: 1, request }]);
    worker.emitMessage({ schema: 1, ok: true, bundle });

    await expect(result).resolves.toEqual(bundle);
    expect(worker.terminated).toBe(true);
  });

  it("terminates the worker and rejects when the caller aborts", async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const result = calculateRouteBundleForPlaces(request, {
      signal: controller.signal,
      workerFactory: () => worker,
    });

    controller.abort();

    await expect(result).rejects.toThrow("ROUTE_CALCULATION_ABORTED");
    expect(worker.terminated).toBe(true);
    worker.emitMessage({ schema: 1, ok: true, bundle });
  });

  it("terminates a worker that exceeds the route deadline", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const result = calculateRouteBundleForPlaces(request, {
      timeoutMs: 1_000,
      workerFactory: () => worker,
    });
    const rejection = expect(result).rejects.toThrow("ROUTE_CALCULATION_TIMEOUT");

    await vi.advanceTimersByTimeAsync(1_000);

    await rejection;
    expect(worker.terminated).toBe(true);
  });

  it("does not expose worker crash details", async () => {
    const worker = new FakeWorker();
    const result = calculateRouteBundleForPlaces(request, {
      workerFactory: () => worker,
    });

    worker.emitError();

    await expect(result).rejects.toThrow("ROUTE_CALCULATION_FAILED");
    expect(worker.terminated).toBe(true);
  });

  it("rejects an oversized or malformed worker response", async () => {
    const worker = new FakeWorker();
    const result = calculateRouteBundleForPlaces(request, {
      workerFactory: () => worker,
    });

    worker.emitMessage({ schema: 1, ok: true, bundle: { routes: [] } });

    await expect(result).rejects.toThrow("ROUTE_CALCULATION_FAILED");
    expect(worker.terminated).toBe(true);
  });
});
