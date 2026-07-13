import { describe, expect, it } from "vitest";
import { buildWalkingDirections, turnKind } from "./directions";
import type { RouteSegment } from "./types";

const point = (lat: number, lon: number) => ({ lat, lon });
const segment = (
  from: ReturnType<typeof point>,
  to: ReturnType<typeof point>,
  overrides: Partial<RouteSegment> = {},
): RouteSegment => ({
  from,
  to,
  shadeRatio: 0.2,
  covered: false,
  ...overrides,
});

describe("turnKind", () => {
  it.each([
    [0, 10, "straight"],
    [0, 40, "slight-right"],
    [0, 90, "right"],
    [90, 0, "left"],
    [270, 0, "right"],
    [0, 180, "uturn-right"],
  ] as const)("classifies %s° → %s° as %s", (before, after, expected) => {
    expect(turnKind(before, after)).toBe(expected);
  });
});

describe("buildWalkingDirections", () => {
  it("groups straight segments and creates right and left turns", () => {
    const a = point(37, 127);
    const b = point(37.00045, 127);
    const c = point(37.0009, 127);
    const d = point(37.0009, 127.001);
    const e = point(37.0018, 127.001);
    const segments = [
      segment(a, b, { shadeRatio: 0.8 }),
      segment(b, c, { shadeRatio: 0.8 }),
      segment(c, d, { shadeRatio: 0.2 }),
      segment(d, e, { shadeRatio: 0.7 }),
    ];

    const result = buildWalkingDirections(segments, "도착역");

    expect(result.map((step) => step.kind)).toEqual([
      "depart",
      "right",
      "left",
      "arrive",
    ]);
    expect(result[0]).toMatchObject({ exposure: "shade" });
    expect(result[1]).toMatchObject({ exposure: "sun" });
    expect(result[3]).toMatchObject({ instruction: "도착역에 도착" });
    expect(result.slice(0, -1).reduce((sum, step) => sum + step.distanceM, 0)).toBeGreaterThan(270);
  });

  it("keeps connector and stairs as friendly semantic steps", () => {
    const a = point(37, 127);
    const b = point(37.00005, 127);
    const c = point(37.0002, 127);
    const d = point(37.0004, 127);
    const result = buildWalkingDirections(
      [
        segment(a, b, { connector: true }),
        segment(b, c),
        segment(c, d, { steps: true, covered: true }),
      ],
      "시청",
    );

    expect(result.map((step) => step.kind)).toEqual([
      "connector",
      "depart",
      "steps",
      "arrive",
    ]);
    expect(result[0].instruction).toBe("보행로까지 이동");
    expect(result[1].instruction).toBe("북쪽 방향으로 이동");
    expect(result[2]).toMatchObject({ instruction: "계단 이용", exposure: "shade" });
  });

  it("ignores zero-length geometry and short directional jitter", () => {
    const a = point(37, 127);
    const b = point(37, 127.001);
    const c = point(37.00003, 127.001);
    const d = point(37.00003, 127.002);
    const original = [segment(a, a), segment(a, b), segment(b, c), segment(c, d)];

    const result = buildWalkingDirections(original, "역삼역");

    expect(result.map((step) => step.kind)).toEqual(["depart", "arrive"]);
    expect(original).toHaveLength(4);
    expect(result.every((step) => Number.isFinite(step.distanceM))).toBe(true);
  });

  it("flattens a short reverse spike that immediately returns to the route", () => {
    const a = point(37, 127);
    const b = point(37, 127.001);
    const c = point(37, 127.00089);
    const d = point(37, 127.002);

    const result = buildWalkingDirections(
      [segment(a, b), segment(b, c), segment(c, d)],
      "도착지",
    );

    expect(result.map((step) => step.kind)).toEqual(["depart", "arrive"]);
    expect(result[0].instruction).toBe("동쪽 방향으로 출발");
  });

  it("returns no false arrival instruction for invalid or empty geometry", () => {
    expect(buildWalkingDirections([], "도착지")).toEqual([]);
    expect(
      buildWalkingDirections(
        [segment(point(Number.NaN, 127), point(37, 127))],
        "도착지",
      ),
    ).toEqual([]);
  });
});
