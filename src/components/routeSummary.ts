import type { RouteMode, RouteResult } from "../domain/routing/types";

export function walkMinutes(seconds: number) {
  return Math.max(1, Math.round(seconds / 60));
}

export function sunMinutes(seconds: number) {
  return Math.max(0, Math.round(seconds / 60));
}

export function distanceLabel(meters: number) {
  return meters >= 1_000 ? `${(meters / 1_000).toFixed(1)}km` : `${meters}m`;
}

export function routeByMode(routes: readonly RouteResult[], mode: RouteMode) {
  return routes.find((route) => route.mode === mode) ?? routes[0];
}

export type RouteComparison =
  | { readonly kind: "baseline"; readonly sunMin: number }
  | { readonly kind: "no-saving"; readonly sunMin: number }
  | {
      readonly kind: "saving";
      readonly extraMin: number;
      readonly sunSavedMin: number;
    };

// 비교는 초 단위 원본이 아니라 표에 보이는 반올림 값으로 계산한다. 그래야 요약 문장과
// 지표 표가 어긋나지 않는다. 반올림 뒤 차이가 사라지면 절약을 주장하지 않는다.
export function compareToShortest(
  selected: RouteResult,
  shortest: RouteResult,
): RouteComparison {
  const selectedSunMin = sunMinutes(selected.sunSec);
  if (selected.mode === shortest.mode) {
    return { kind: "baseline", sunMin: selectedSunMin };
  }

  const sunSavedMin = sunMinutes(shortest.sunSec) - selectedSunMin;
  if (sunSavedMin <= 0) {
    return { kind: "no-saving", sunMin: selectedSunMin };
  }

  // 빠른길이 시간 기준 최적이므로 차이는 보통 양수다. 반올림이나 동점으로 음수가 나와도
  // `-1분 더 걸리고`처럼 읽히지 않도록 0으로 자른다.
  const extraMin = Math.max(
    0,
    walkMinutes(selected.timeSec) - walkMinutes(shortest.timeSec),
  );
  return { kind: "saving", extraMin, sunSavedMin };
}

export interface SummarySegment {
  readonly text: string;
  readonly strong?: boolean;
}

// 문장을 조각으로 돌려주어 화면에서 숫자만 강조할 수 있게 한다. 조각을 이어 붙이면
// 그대로 한 문장이 되므로 문구와 화면 표시가 어긋나지 않는다.
//
// 경로 라벨은 `빠른길`, `균형`, `그늘우선` 세 개로 고정이고 모두 받침으로 끝나므로
// 보조사는 `은`으로 충분하다. 라벨을 늘릴 때는 조사 처리를 함께 검토한다.
export function comparisonSegments(
  label: string,
  comparison: RouteComparison,
): readonly SummarySegment[] {
  if (comparison.kind !== "saving") {
    return [
      { text: `${label}의 예상 햇빛 노출은 ` },
      { text: `${comparison.sunMin}분`, strong: true },
      { text: "이에요." },
    ];
  }

  const lead: readonly SummarySegment[] =
    comparison.extraMin === 0
      ? [{ text: `${label}은 빠른길보다 더 걸리지 않고, ` }]
      : [
          { text: `${label}은 빠른길보다 ` },
          { text: `${comparison.extraMin}분`, strong: true },
          { text: " 더 걸리고, " },
        ];

  return [
    ...lead,
    { text: "예상 햇빛 노출은 " },
    { text: `${comparison.sunSavedMin}분`, strong: true },
    { text: " 적어요." },
  ];
}

export function comparisonSentence(
  label: string,
  comparison: RouteComparison,
): string {
  return comparisonSegments(label, comparison)
    .map((segment) => segment.text)
    .join("");
}
