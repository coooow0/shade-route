import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ResultSheetHandle from "./ResultSheetHandle";

function renderHandle(expanded = true) {
  const onExpandedChange = vi.fn();
  const onDragHeightChange = vi.fn();
  const onPeekHeightChange = vi.fn();
  const { container } = render(
    <aside className={expanded ? "c-sheet" : "c-sheet is-collapsed"}>
      <ResultSheetHandle
        expanded={expanded}
        controls="route-sheet-directions"
        onExpandedChange={onExpandedChange}
        onDragHeightChange={onDragHeightChange}
        onPeekHeightChange={onPeekHeightChange}
      />
      <table>
        <thead>
          <tr>
            <th>경로</th>
          </tr>
        </thead>
      </table>
      <div
        className="c-sheet-time"
        role="group"
        aria-label="출발 시각"
        data-sheet-peek-end
      >
        <button type="button">지금</button>
      </div>
    </aside>,
  );
  const sheet = container.querySelector(".c-sheet");
  const header = container.querySelector("thead");
  const timeOptions = container.querySelector(".c-sheet-time");
  if (
    !(sheet instanceof HTMLElement) ||
    !(header instanceof HTMLElement) ||
    !(timeOptions instanceof HTMLElement)
  ) {
    throw new Error("Missing test sheet layout");
  }
  Object.defineProperty(sheet, "scrollHeight", {
    configurable: true,
    value: 500,
  });
  vi.spyOn(sheet, "getBoundingClientRect").mockReturnValue({
    top: 0,
    right: 390,
    bottom: expanded ? 500 : 104,
    left: 0,
    width: 390,
    height: expanded ? 500 : 104,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  vi.spyOn(header, "getBoundingClientRect").mockReturnValue({
    top: 44,
    right: 390,
    bottom: 96,
    left: 0,
    width: 390,
    height: 52,
    x: 0,
    y: 44,
    toJSON: () => ({}),
  });
  vi.spyOn(timeOptions, "getBoundingClientRect").mockReturnValue({
    top: 260,
    right: 390,
    bottom: 304,
    left: 0,
    width: 390,
    height: 44,
    x: 0,
    y: 260,
    toJSON: () => ({}),
  });
  return { onDragHeightChange, onExpandedChange, onPeekHeightChange, sheet };
}

function dragHandle(fromY: number, toY: number) {
  const handle = document.querySelector(".c-sheet-handle");
  if (!(handle instanceof HTMLButtonElement)) {
    throw new Error("Missing sheet handle");
  }
  fireEvent.pointerDown(handle, {
    button: 0,
    clientY: fromY,
    isPrimary: true,
    pointerId: 1,
  });
  fireEvent.pointerUp(handle, {
    button: 0,
    clientY: toY,
    isPrimary: true,
    pointerId: 1,
  });
}

describe("ResultSheetHandle", () => {
  it("exposes the sheet state and toggles it when clicked", () => {
    const { onExpandedChange } = renderHandle();
    const handle = screen.getByRole("button", { name: "경로 정보 접기" });

    expect(handle).toHaveAttribute("aria-expanded", "true");
    expect(handle).toHaveAttribute("aria-controls", "route-sheet-directions");

    fireEvent.click(handle);

    expect(onExpandedChange).toHaveBeenCalledWith(false);
  });

  it("collapses after a downward drag beyond the threshold", () => {
    const { onDragHeightChange, onExpandedChange, onPeekHeightChange } =
      renderHandle();
    const handle = screen.getByRole("button", { name: "경로 정보 접기" });

    fireEvent.pointerDown(handle, {
      button: 0,
      clientY: 100,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerMove(handle, {
      button: 0,
      clientY: 132,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerMove(handle, {
      button: 0,
      clientY: 700,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerUp(handle, {
      button: 0,
      clientY: 700,
      isPrimary: true,
      pointerId: 1,
    });

    expect(onDragHeightChange).toHaveBeenNthCalledWith(1, 500);
    expect(onDragHeightChange).toHaveBeenCalledWith(468);
    expect(onDragHeightChange).toHaveBeenCalledWith(312);
    expect(onDragHeightChange).toHaveBeenLastCalledWith(null);
    expect(onPeekHeightChange).toHaveBeenCalledWith(312);
    expect(onExpandedChange).toHaveBeenCalledWith(false);
    expect(onExpandedChange).toHaveBeenCalledTimes(1);
  });

  it("expands after an upward drag beyond the threshold", () => {
    const { onDragHeightChange, onExpandedChange } = renderHandle(false);

    dragHandle(148, 100);

    expect(onDragHeightChange).toHaveBeenNthCalledWith(1, 312);
    expect(onExpandedChange).toHaveBeenCalledWith(true);
  });

  it("ignores short and cancelled drags", () => {
    const { onExpandedChange, sheet } = renderHandle();
    const handle = screen.getByRole("button", { name: "경로 정보 접기" });
    sheet.scrollTop = 220;

    dragHandle(100, 120);
    expect(sheet.scrollTop).toBe(220);

    fireEvent.pointerDown(handle, {
      button: 0,
      clientY: 100,
      isPrimary: true,
      pointerId: 2,
    });
    fireEvent.pointerCancel(handle, { pointerId: 2 });

    expect(sheet.scrollTop).toBe(220);
    expect(onExpandedChange).not.toHaveBeenCalled();
  });

  it("finishes the drag when pointer capture is unavailable and release happens outside", () => {
    const { onDragHeightChange, onExpandedChange } = renderHandle();
    const handle = screen.getByRole("button", { name: "경로 정보 접기" });

    fireEvent.pointerDown(handle, {
      button: 0,
      clientY: 100,
      isPrimary: true,
      pointerId: 3,
    });
    fireEvent.pointerMove(window, {
      clientY: 132,
      isPrimary: true,
      pointerId: 3,
    });
    fireEvent.pointerUp(window, {
      clientY: 148,
      isPrimary: true,
      pointerId: 3,
    });

    expect(onDragHeightChange).toHaveBeenCalledWith(468);
    expect(onDragHeightChange).toHaveBeenLastCalledWith(null);
    expect(onExpandedChange).toHaveBeenCalledWith(false);
  });
});
