import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import PlaceCombobox from "./PlaceCombobox";
import type { Place } from "../domain/routing/types";

const gangnam: Place = {
  id: "gangnam",
  name: "강남",
  lat: 37.498,
  lon: 127.028,
};
const jonggak: Place = {
  id: "jonggak",
  name: "종각",
  lat: 37.57,
  lon: 126.983,
};
const toss: Place = {
  id: "toss",
  name: "토스플레이스",
  kind: "office",
  address: "서울 강남구 테헤란로 142",
  lat: 37.5007,
  lon: 127.0364,
};

function Harness({ onSelect }: { readonly onSelect: (place: Place) => void }) {
  const [selected, setSelected] = useState(gangnam);
  return (
    <PlaceCombobox
      id="start"
      label="출발지"
      selected={selected}
      places={[gangnam, jonggak]}
      onSelect={(place) => {
        setSelected(place);
        onSelect(place);
      }}
    />
  );
}

describe("PlaceCombobox", () => {
  it("searches and commits a place without a native select", () => {
    const onSelect = vi.fn();
    render(
      <PlaceCombobox
        id="goal"
        label="도착지"
        selected={gangnam}
        places={[gangnam, jonggak]}
        onSelect={onSelect}
      />,
    );

    const input = screen.getByRole("combobox", { name: "도착지 검색" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "종각역" } });
    const option = screen.getByRole("option", { name: "종각" });
    fireEvent.pointerDown(option);
    fireEvent.click(option);

    expect(onSelect).toHaveBeenCalledWith(jonggak);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("supports keyboard selection and Escape cancellation", () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const input = screen.getByRole("combobox", { name: "출발지 검색" });

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "종" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(jonggak);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "없는 장소" } });
    expect(screen.getByRole("status")).toHaveTextContent("검색 결과가 없어요");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("종각");
  });

  it("commits an exact match with the mobile search key", () => {
    const onSelect = vi.fn();
    const onEditingChange = vi.fn();
    render(
      <PlaceCombobox
        id="goal"
        label="도착지"
        selected={gangnam}
        places={[gangnam, jonggak]}
        onSelect={onSelect}
        onEditingChange={onEditingChange}
      />,
    );

    const input = screen.getByRole("combobox", { name: "도착지 검색" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "종각역" } });
    expect(onEditingChange).toHaveBeenLastCalledWith(true);
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith(jonggak);
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
  });

  it("keeps an uncommitted query after blur and removes options from Tab order", () => {
    const onEditingChange = vi.fn();
    render(
      <PlaceCombobox
        id="start"
        label="출발지"
        selected={gangnam}
        places={[gangnam, jonggak]}
        onSelect={vi.fn()}
        onEditingChange={onEditingChange}
      />,
    );

    const input = screen.getByRole("combobox", { name: "출발지 검색" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "종" } });
    expect(screen.getByRole("option", { name: "종각" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
    fireEvent.blur(input, { relatedTarget: document.body });

    expect(input).toHaveValue("종");
    expect(onEditingChange).toHaveBeenLastCalledWith(true);
  });

  it("shows destination type and address instead of a station-only label", () => {
    render(
      <PlaceCombobox
        id="goal"
        label="도착지"
        selected={gangnam}
        places={[gangnam, toss]}
        onSelect={vi.fn()}
      />,
    );

    const input = screen.getByRole("combobox", { name: "도착지 검색" });
    expect(input).toHaveAttribute("placeholder", "장소·주소를 검색하세요");
    expect(input).toHaveAttribute("maxlength", "100");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "테헤란로 142" } });

    expect(
      screen.getByRole("option", {
        name: "토스플레이스, 회사 · 서울 강남구 테헤란로 142",
      }),
    ).toHaveTextContent(
      "회사 · 서울 강남구 테헤란로 142",
    );
    expect(screen.queryByText("서울 지하철역")).not.toBeInTheDocument();
  });
});
