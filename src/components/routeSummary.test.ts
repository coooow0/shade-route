import { describe, expect, test } from "vitest";
import type { RouteMode, RouteResult } from "../domain/routing/types";
import { compareToShortest, comparisonSentence } from "./routeSummary";

function route(
  mode: RouteMode,
  label: string,
  timeSec: number,
  sunSec: number,
): RouteResult {
  return {
    mode,
    label,
    pathKey: `${mode}-${timeSec}-${sunSec}`,
    timeSec,
    lengthM: 800,
    sunSec,
    shadeRatio: 0.5,
    segments: [],
  };
}

const shortest = route("shortest", "빠른길", 600, 540);

describe("compareToShortest", () => {
  test("빠른길을 선택하면 비교 대신 예상 햇빛 노출 절대값을 돌려준다", () => {
    // Arrange
    const selected = route("shortest", "빠른길", 600, 540);

    // Act
    const comparison = compareToShortest(selected, shortest);

    // Assert
    expect(comparison).toEqual({ kind: "baseline", sunMin: 9 });
  });

  test("예상 햇빛 절약이 양수면 시간 차이와 함께 돌려준다", () => {
    // Arrange
    const selected = route("maxShade", "그늘우선", 720, 60);

    // Act
    const comparison = compareToShortest(selected, shortest);

    // Assert
    expect(comparison).toEqual({
      kind: "saving",
      extraMin: 2,
      sunSavedMin: 8,
    });
  });

  test("예상 햇빛 절약이 0분이면 절약을 주장하지 않는다", () => {
    // Arrange
    const selected = route("balanced", "균형", 660, 540);

    // Act
    const comparison = compareToShortest(selected, shortest);

    // Assert
    expect(comparison).toEqual({ kind: "no-saving", sunMin: 9 });
  });

  test("예상 햇빛 노출이 오히려 많으면 절약을 주장하지 않는다", () => {
    // Arrange
    const selected = route("balanced", "균형", 660, 600);

    // Act
    const comparison = compareToShortest(selected, shortest);

    // Assert
    expect(comparison).toEqual({ kind: "no-saving", sunMin: 10 });
  });

  test("반올림 뒤 시간 차이가 0분이면 더 걸리지 않은 것으로 본다", () => {
    // Arrange
    const selected = route("maxShade", "그늘우선", 610, 60);

    // Act
    const comparison = compareToShortest(selected, shortest);

    // Assert
    expect(comparison).toEqual({
      kind: "saving",
      extraMin: 0,
      sunSavedMin: 8,
    });
  });

  test("선택한 경로가 더 빨라도 음수 시간 차이를 표시하지 않는다", () => {
    // Arrange
    const selected = route("maxShade", "그늘우선", 480, 60);

    // Act
    const comparison = compareToShortest(selected, shortest);

    // Assert
    expect(comparison).toEqual({
      kind: "saving",
      extraMin: 0,
      sunSavedMin: 8,
    });
  });

  test("표에 보이는 반올림 값과 같은 기준으로 차이를 계산한다", () => {
    // Arrange: 29초 차이는 표에서 둘 다 9분으로 보인다.
    const selected = route("balanced", "균형", 660, 511);

    // Act
    const comparison = compareToShortest(selected, shortest);

    // Assert
    expect(comparison).toEqual({ kind: "no-saving", sunMin: 9 });
  });
});

describe("comparisonSentence", () => {
  test("절약과 추가 시간이 모두 있으면 둘을 함께 말한다", () => {
    // Arrange
    const comparison = compareToShortest(
      route("maxShade", "그늘우선", 720, 60),
      shortest,
    );

    // Act
    const sentence = comparisonSentence("그늘우선", comparison);

    // Assert
    expect(sentence).toBe(
      "그늘우선은 빠른길보다 2분 더 걸리고, 예상 햇빛 노출은 8분 적어요.",
    );
  });

  test("추가 시간이 없으면 더 걸리지 않는다고 말한다", () => {
    // Arrange
    const comparison = compareToShortest(
      route("maxShade", "그늘우선", 610, 60),
      shortest,
    );

    // Act
    const sentence = comparisonSentence("그늘우선", comparison);

    // Assert
    expect(sentence).toBe(
      "그늘우선은 빠른길보다 더 걸리지 않고, 예상 햇빛 노출은 8분 적어요.",
    );
  });

  test("빠른길을 선택하면 비교 없이 예상 햇빛 노출만 말한다", () => {
    // Arrange
    const comparison = compareToShortest(shortest, shortest);

    // Act
    const sentence = comparisonSentence("빠른길", comparison);

    // Assert
    expect(sentence).toBe("빠른길의 예상 햇빛 노출은 9분이에요.");
  });

  test("절약이 없으면 절약을 주장하지 않고 노출만 말한다", () => {
    // Arrange
    const comparison = compareToShortest(
      route("balanced", "균형", 660, 600),
      shortest,
    );

    // Act
    const sentence = comparisonSentence("균형", comparison);

    // Assert
    expect(sentence).toBe("균형의 예상 햇빛 노출은 10분이에요.");
  });
});
