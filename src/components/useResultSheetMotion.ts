import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

const DEFAULT_PEEK_HEIGHT_PX = 312;
const SETTLE_DURATION_MS = 260;

export interface ResultSheetMotionHandleProps {
  readonly expanded: boolean;
  readonly onExpandedChange: (expanded: boolean) => void;
  readonly onDragHeightChange: (height: number | null) => void;
  readonly onPeekHeightChange: (height: number) => void;
}

interface ResultSheetStyle extends CSSProperties {
  readonly "--result-sheet-peek-height": string;
  readonly "--result-sheet-drag-height": string;
}

export function useResultSheetMotion() {
  const [expanded, setExpanded] = useState(true);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const [peekHeight, setPeekHeight] = useState(DEFAULT_PEEK_HEIGHT_PX);
  const [settling, setSettling] = useState(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSettleTimer = useCallback(() => {
    if (settleTimer.current !== null) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
  }, []);

  useEffect(() => () => clearSettleTimer(), [clearSettleTimer]);

  const expand = useCallback(() => {
    clearSettleTimer();
    setExpanded(true);
    setDragHeight(null);
    setSettling(false);
  }, [clearSettleTimer]);
  const handleExpandedChange = useCallback(
    (nextExpanded: boolean) => {
      clearSettleTimer();
      setExpanded(nextExpanded);
      setSettling(true);
      settleTimer.current = setTimeout(() => {
        settleTimer.current = null;
        setSettling(false);
      }, SETTLE_DURATION_MS);
    },
    [clearSettleTimer],
  );
  const handleDragHeightChange = useCallback(
    (height: number | null) => {
      if (height !== null) {
        clearSettleTimer();
        setSettling(false);
      }
      setDragHeight(height);
    },
    [clearSettleTimer],
  );
  const handlePeekHeightChange = useCallback((height: number) => {
    if (Number.isFinite(height) && height > 0) {
      setPeekHeight(height);
    }
  }, []);

  const sheetProps = useMemo(() => {
    const className = [
      "c-sheet",
      expanded ? "" : "is-collapsed",
      dragHeight === null ? "" : "is-dragging",
      settling ? "is-settling" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const style: ResultSheetStyle = {
      "--result-sheet-peek-height": `${peekHeight}px`,
      "--result-sheet-drag-height": `${dragHeight ?? peekHeight}px`,
    };
    return { className, style };
  }, [dragHeight, expanded, peekHeight, settling]);

  const handleProps = useMemo<ResultSheetMotionHandleProps>(
    () => ({
      expanded,
      onExpandedChange: handleExpandedChange,
      onDragHeightChange: handleDragHeightChange,
      onPeekHeightChange: handlePeekHeightChange,
    }),
    [
      expanded,
      handleDragHeightChange,
      handleExpandedChange,
      handlePeekHeightChange,
    ],
  );

  return { expand, handleProps, sheetProps };
}
