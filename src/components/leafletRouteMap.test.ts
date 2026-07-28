import { afterEach, describe, expect, it, vi } from "vitest";
import type { Place, RouteResult } from "../domain/routing/types";

const leaflet = vi.hoisted(() => {
  const makeMarker = () => {
    const marker = {
      addTo: vi.fn(),
      bindTooltip: vi.fn(),
      setLatLng: vi.fn(),
    };
    marker.addTo.mockReturnValue(marker);
    marker.bindTooltip.mockReturnValue(marker);
    return marker;
  };
  const markerLayers: ReturnType<typeof makeMarker>[] = [];
  const circleLayer = {
    addTo: vi.fn(),
    setLatLng: vi.fn(),
    setRadius: vi.fn(),
  };
  circleLayer.addTo.mockReturnValue(circleLayer);
  const map = {
    fitBounds: vi.fn(),
    invalidateSize: vi.fn(),
    panTo: vi.fn(),
    remove: vi.fn(),
    removeLayer: vi.fn(),
  };
  const tileLayer = {
    on: vi.fn(),
    addTo: vi.fn(),
  };
  tileLayer.on.mockReturnValue(tileLayer);
  tileLayer.addTo.mockReturnValue(tileLayer);
  const bounds = { extend: vi.fn() };
  const circleMarker = vi.fn(() => {
    const marker = makeMarker();
    markerLayers.push(marker);
    return marker;
  });

  return {
    bounds,
    circleLayer,
    circleMarker,
    map,
    markerLayers,
    tileLayer,
    api: {
      map: vi.fn(() => map),
      control: { zoom: vi.fn(() => ({ addTo: vi.fn() })) },
      tileLayer: vi.fn(() => tileLayer),
      latLngBounds: vi.fn(() => bounds),
      polyline: vi.fn(() => ({ addTo: vi.fn() })),
      circleMarker,
      circle: vi.fn(() => circleLayer),
      latLng: vi.fn((lat: number, lon: number) => ({ lat, lng: lon })),
    },
  };
});

vi.mock("leaflet", () => ({ default: leaflet.api }));

import { mountLeafletRouteMap } from "./leafletRouteMap";

const start: Place = {
  id: "start",
  name: "강남역",
  lat: 37.5,
  lon: 127.028,
};
const goal: Place = {
  id: "goal",
  name: "역삼역",
  lat: 37.501,
  lon: 127.036,
};
const route: RouteResult = {
  mode: "balanced",
  label: "균형",
  pathKey: "route",
  timeSec: 600,
  lengthM: 800,
  sunSec: 300,
  shadeRatio: 0.5,
  segments: [
    {
      from: start,
      to: goal,
      shadeRatio: 0.5,
      covered: false,
    },
  ],
};

describe("mountLeafletRouteMap", () => {
  afterEach(() => {
    vi.clearAllMocks();
    leaflet.markerLayers.length = 0;
    vi.unstubAllGlobals();
  });

  it("moves one raw location marker and accuracy circle without snapping", () => {
    vi.stubGlobal("navigator", { userAgent: "iPhone" });
    const controller = mountLeafletRouteMap({
      element: document.createElement("div"),
      route,
      start,
      goal,
      onTileError: vi.fn(),
    });
    expect(leaflet.api.control.zoom).toHaveBeenCalledWith({
      position: "topright",
    });
    const first = {
      lat: 37.5003,
      lon: 127.0317,
      accuracyM: 12,
      timestampMs: 1,
    };
    const second = {
      lat: 37.5005,
      lon: 127.0321,
      accuracyM: 5_000,
      timestampMs: 2,
    };

    controller.updateCurrentLocation(first, false);
    expect(leaflet.api.circle).toHaveBeenCalledWith(
      { lat: first.lat, lng: first.lon },
      expect.objectContaining({ radius: 12 }),
    );
    expect(leaflet.circleMarker).toHaveBeenLastCalledWith(
      { lat: first.lat, lng: first.lon },
      expect.objectContaining({ fillColor: "#3182f6" }),
    );
    expect(leaflet.map.panTo).not.toHaveBeenCalled();

    const currentMarker = leaflet.markerLayers[leaflet.markerLayers.length - 1];
    controller.updateCurrentLocation(second, true);
    expect(leaflet.api.circle).toHaveBeenCalledOnce();
    expect(leaflet.circleLayer.setLatLng).toHaveBeenCalledWith({
      lat: second.lat,
      lng: second.lon,
    });
    expect(leaflet.circleLayer.setRadius).toHaveBeenCalledWith(1_000);
    expect(currentMarker?.setLatLng).toHaveBeenCalledWith({
      lat: second.lat,
      lng: second.lon,
    });
    expect(leaflet.map.panTo).toHaveBeenCalledWith(
      { lat: second.lat, lng: second.lon },
      expect.objectContaining({ animate: true }),
    );

    controller.updateCurrentLocation(null, false);
    expect(leaflet.map.removeLayer).toHaveBeenCalledTimes(2);
    controller.destroy();
    controller.destroy();
    expect(leaflet.map.remove).toHaveBeenCalledOnce();
  });

  it("groups route segments into a bounded number of Leaflet layers", () => {
    vi.stubGlobal("navigator", { userAgent: "iPhone" });
    const segments = Array.from({ length: 300 }, (_, index) => ({
      from: { lat: 37.5, lon: 127.028 + index * 0.000001 },
      to: { lat: 37.5, lon: 127.028 + (index + 1) * 0.000001 },
      shadeRatio: index % 3 === 0 ? 0.8 : 0.2,
      covered: false,
      connector: index % 3 === 2,
    }));

    mountLeafletRouteMap({
      element: document.createElement("div"),
      route: { ...route, pathKey: "many-segments", segments },
      start,
      goal,
      onTileError: vi.fn(),
    });

    expect(leaflet.api.polyline).toHaveBeenCalledTimes(4);
  });

  it("fits the route inside the map area that is not covered by the result sheet", () => {
    vi.stubGlobal("navigator", { userAgent: "iPhone" });
    const element = document.createElement("div");
    const sheet = document.createElement("aside");
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      top: 56,
      right: 390,
      bottom: 844,
      left: 0,
      width: 390,
      height: 788,
      x: 0,
      y: 56,
      toJSON: () => ({}),
    });
    vi.spyOn(sheet, "getBoundingClientRect").mockReturnValue({
      top: 321,
      right: 390,
      bottom: 844,
      left: 0,
      width: 390,
      height: 523,
      x: 0,
      y: 321,
      toJSON: () => ({}),
    });

    const controller = mountLeafletRouteMap({
      element,
      route,
      start,
      goal,
      onTileError: vi.fn(),
      getBottomOcclusionElement: () => sheet,
    });

    expect(leaflet.map.fitBounds).toHaveBeenCalledWith(leaflet.bounds, {
      paddingTopLeft: [28, 28],
      paddingBottomRight: [28, 551],
      maxZoom: 17,
    });
    controller.destroy();
  });

  it("uses normal route padding when the result panel sits beside the map", () => {
    vi.stubGlobal("navigator", { userAgent: "iPhone" });
    const element = document.createElement("div");
    const panel = document.createElement("aside");
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      top: 56,
      right: 445,
      bottom: 1_024,
      left: 0,
      width: 445,
      height: 968,
      x: 0,
      y: 56,
      toJSON: () => ({}),
    });
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
      top: 56,
      right: 768,
      bottom: 1_024,
      left: 445,
      width: 323,
      height: 968,
      x: 445,
      y: 56,
      toJSON: () => ({}),
    });

    const controller = mountLeafletRouteMap({
      element,
      route,
      start,
      goal,
      onTileError: vi.fn(),
      getBottomOcclusionElement: () => panel,
    });

    expect(leaflet.map.fitBounds).toHaveBeenCalledWith(leaflet.bounds, {
      paddingTopLeft: [28, 28],
      paddingBottomRight: [28, 28],
      maxZoom: 17,
    });
    controller.destroy();
  });
});
