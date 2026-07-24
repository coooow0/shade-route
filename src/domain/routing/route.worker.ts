/// <reference lib="webworker" />

import { calculateRouteBundleForPlaces } from "./routeService";
import {
  isRouteWorkerRequest,
  safeRouteWorkerError,
} from "./routeWorkerProtocol";

const scope = globalThis as unknown as {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  postMessage(message: unknown): void;
};

let started = false;
scope.addEventListener("message", (event) => {
  if (started || !isRouteWorkerRequest(event.data)) {
    scope.postMessage({
      schema: 1,
      ok: false,
      error: "ROUTE_CALCULATION_FAILED",
    });
    return;
  }
  started = true;
  void calculateRouteBundleForPlaces(event.data.request)
    .then((bundle) => {
      scope.postMessage({ schema: 1, ok: true, bundle });
    })
    .catch((error: unknown) => {
      scope.postMessage({
        schema: 1,
        ok: false,
        error: safeRouteWorkerError(error),
      });
    });
});
