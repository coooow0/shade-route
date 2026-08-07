import {
  useEffect,
  useLayoutEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { ResultSheetMotionHandleProps } from "./useResultSheetMotion";

const DRAG_THRESHOLD_PX = 40;
const TAP_SLOP_PX = 6;
const COLLAPSED_BOTTOM_GAP_PX = 8;
const DEFAULT_PEEK_HEIGHT_PX = 312;
const EXPANDED_VIEWPORT_RATIO = 0.66;

interface ResultSheetHandleProps extends ResultSheetMotionHandleProps {
  readonly controls: string;
}

interface DragStart {
  readonly pointerId: number;
  readonly clientY: number;
  readonly startHeight: number;
  readonly expandedHeight: number;
  readonly peekHeight: number;
  readonly previousScrollTop: number;
  readonly sheet: HTMLElement;
}

interface SheetMeasurements {
  readonly sheet: HTMLElement;
  readonly peekBoundary: HTMLElement;
  readonly expandedHeight: number;
  readonly peekHeight: number;
  readonly previousScrollTop: number;
}

function sheetMeasurements(
  handle: HTMLButtonElement,
  resetScroll: boolean,
  expanded: boolean,
): SheetMeasurements | null {
  const sheet = handle.closest<HTMLElement>(".c-sheet");
  const peekBoundary = sheet?.querySelector<HTMLElement>(
    "[data-sheet-peek-end]",
  );
  if (!sheet || !peekBoundary) return null;
  const previousScrollTop = sheet.scrollTop;
  if (resetScroll) sheet.scrollTop = 0;

  const sheetRect = sheet.getBoundingClientRect();
  const peekBoundaryRect = peekBoundary.getBoundingClientRect();
  const measuredPeekHeight =
    peekBoundaryRect.bottom - sheetRect.top + sheet.scrollTop;
  const peekHeight =
    measuredPeekHeight > 0
      ? Math.ceil(measuredPeekHeight + COLLAPSED_BOTTOM_GAP_PX)
      : DEFAULT_PEEK_HEIGHT_PX;
  const viewportMaxHeight = globalThis.innerHeight * EXPANDED_VIEWPORT_RATIO;
  const contentHeight = sheet.scrollHeight || sheetRect.height || peekHeight;
  const calculatedExpandedHeight = Math.max(
    peekHeight,
    Math.min(
      contentHeight,
      viewportMaxHeight > 0 ? viewportMaxHeight : contentHeight,
    ),
  );
  const expandedHeight =
    expanded && sheetRect.height > peekHeight
      ? sheetRect.height
      : calculatedExpandedHeight;

  return {
    sheet,
    peekBoundary,
    expandedHeight,
    peekHeight,
    previousScrollTop,
  };
}

export default function ResultSheetHandle({
  expanded,
  controls,
  onExpandedChange,
  onDragHeightChange,
  onPeekHeightChange,
}: ResultSheetHandleProps) {
  const handleElement = useRef<HTMLButtonElement | null>(null);
  const dragStart = useRef<DragStart | null>(null);
  const fallbackPointerCleanup = useRef<(() => void) | null>(null);
  const ignoreClickUntil = useRef(0);

  const clearFallbackPointerListeners = (): void => {
    fallbackPointerCleanup.current?.();
    fallbackPointerCleanup.current = null;
  };

  useEffect(
    () => () => {
      fallbackPointerCleanup.current?.();
    },
    [],
  );

  useLayoutEffect(() => {
    const handle = handleElement.current;
    if (!handle) return undefined;
    const initialMeasurements = sheetMeasurements(handle, false, expanded);
    if (!initialMeasurements) return undefined;

    const updatePeekHeight = () => {
      const measurements = sheetMeasurements(handle, false, expanded);
      if (measurements) onPeekHeightChange(measurements.peekHeight);
    };
    updatePeekHeight();

    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(updatePeekHeight);
    observer.observe(initialMeasurements.sheet);
    observer.observe(initialMeasurements.peekBoundary);
    return () => observer.disconnect();
  }, [expanded, onPeekHeightChange]);

  const releasePointer = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void => {
    if (
      typeof event.currentTarget.hasPointerCapture !== "function" ||
      typeof event.currentTarget.releasePointerCapture !== "function" ||
      !event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      return;
    }
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const updateDragHeight = (pointerId: number, clientY: number): boolean => {
    const start = dragStart.current;
    if (start === null || start.pointerId !== pointerId) return false;
    const deltaY = clientY - start.clientY;
    const nextHeight = Math.min(
      start.expandedHeight,
      Math.max(start.peekHeight, start.startHeight - deltaY),
    );
    onDragHeightChange(nextHeight);
    return true;
  };

  const finishDrag = (
    pointerId: number,
    clientY: number,
    cancelled: boolean,
  ): boolean => {
    const start = dragStart.current;
    if (start === null || start.pointerId !== pointerId) return false;

    dragStart.current = null;
    clearFallbackPointerListeners();
    onDragHeightChange(null);
    const deltaY = clientY - start.clientY;
    const distance = Math.abs(deltaY);

    if (cancelled || (distance > TAP_SLOP_PX && distance < DRAG_THRESHOLD_PX)) {
      start.sheet.scrollTop = start.previousScrollTop;
    }
    if (cancelled) return true;
    if (distance >= DRAG_THRESHOLD_PX) {
      ignoreClickUntil.current = Date.now() + 500;
      onExpandedChange(deltaY < 0);
      return true;
    }
    if (distance > TAP_SLOP_PX) {
      ignoreClickUntil.current = Date.now() + 500;
    }
    return true;
  };

  const installFallbackPointerListeners = (): void => {
    const handle = handleElement.current;
    const handlePointerMoveOutside = (event: PointerEvent) => {
      if (event.target === handle) return;
      if (updateDragHeight(event.pointerId, event.clientY)) {
        event.preventDefault();
      }
    };
    const handlePointerUpOutside = (event: PointerEvent) => {
      if (event.target === handle) return;
      finishDrag(event.pointerId, event.clientY, false);
    };
    const handlePointerCancelOutside = (event: PointerEvent) => {
      if (event.target === handle) return;
      finishDrag(event.pointerId, event.clientY, true);
    };

    window.addEventListener("pointermove", handlePointerMoveOutside);
    window.addEventListener("pointerup", handlePointerUpOutside);
    window.addEventListener("pointercancel", handlePointerCancelOutside);
    fallbackPointerCleanup.current = () => {
      window.removeEventListener("pointermove", handlePointerMoveOutside);
      window.removeEventListener("pointerup", handlePointerUpOutside);
      window.removeEventListener("pointercancel", handlePointerCancelOutside);
    };
  };

  const handlePointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void => {
    if (event.button !== 0 || event.isPrimary === false) return;
    const measurements = sheetMeasurements(event.currentTarget, true, expanded);
    if (!measurements) return;
    onPeekHeightChange(measurements.peekHeight);
    const startHeight = expanded
      ? measurements.expandedHeight
      : measurements.peekHeight;
    dragStart.current = {
      pointerId: event.pointerId,
      clientY: event.clientY,
      startHeight,
      expandedHeight: measurements.expandedHeight,
      peekHeight: measurements.peekHeight,
      previousScrollTop: measurements.previousScrollTop,
      sheet: measurements.sheet,
    };
    onDragHeightChange(startHeight);
    clearFallbackPointerListeners();
    try {
      if (typeof event.currentTarget.setPointerCapture !== "function") {
        installFallbackPointerListeners();
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      installFallbackPointerListeners();
    }
  };

  const handlePointerMove = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void => {
    if (updateDragHeight(event.pointerId, event.clientY)) {
      event.preventDefault();
    }
  };

  const handlePointerUp = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void => {
    if (!finishDrag(event.pointerId, event.clientY, false)) return;
    releasePointer(event);
  };

  const handlePointerCancel = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void => {
    if (!finishDrag(event.pointerId, event.clientY, true)) return;
    releasePointer(event);
  };

  return (
    <button
      ref={handleElement}
      type="button"
      className="c-sheet-handle"
      aria-label={expanded ? "경로 정보 접기" : "경로 정보 펼치기"}
      aria-controls={controls}
      aria-expanded={expanded}
      onClick={(event) => {
        if (Date.now() < ignoreClickUntil.current) {
          ignoreClickUntil.current = 0;
          return;
        }
        const measurements = sheetMeasurements(
          event.currentTarget,
          true,
          expanded,
        );
        if (measurements) onPeekHeightChange(measurements.peekHeight);
        onExpandedChange(!expanded);
        onDragHeightChange(null);
      }}
      onPointerCancel={handlePointerCancel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onLostPointerCapture={handlePointerCancel}
    />
  );
}
