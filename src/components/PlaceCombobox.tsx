import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  normalizePlaceQuery,
  searchPlaces,
} from "../domain/places/searchPlaces";
import type { Place } from "../domain/routing/types";

const KIND_LABEL = {
  station: "지하철역",
  cafe: "카페",
  food: "음식점",
  medical: "병원·약국",
  education: "학교·도서관",
  store: "상점",
  office: "회사",
  park: "공원",
  landmark: "명소",
  building: "건물",
  address: "주소",
} as const;

function placeDescription(place: Place) {
  const kind = place.kind ? KIND_LABEL[place.kind] : "장소";
  return place.address ? `${kind} · ${place.address}` : kind;
}

interface PlaceComboboxProps {
  readonly id: string;
  readonly label: string;
  readonly selected: Place;
  readonly places: readonly Place[];
  readonly onSelect: (place: Place) => void;
  readonly onEditingChange?: (editing: boolean) => void;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly describedBy?: string;
}

export default function PlaceCombobox({
  id,
  label,
  selected,
  places,
  onSelect,
  onEditingChange,
  disabled = false,
  invalid = false,
  describedBy,
}: PlaceComboboxProps) {
  const [draft, setDraft] = useState(selected.name);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const listboxId = `${id}-search-results`;
  const deferredDraft = useDeferredValue(draft);
  const searchPending = deferredDraft !== draft;
  const results = useMemo(
    () => open && !searchPending ? searchPlaces(places, deferredDraft) : [],
    [deferredDraft, open, places, searchPending],
  );

  useEffect(() => {
    setDraft(selected.name);
  }, [selected.id, selected.name]);

  useEffect(() => {
    const active = results[activeIndex];
    const option = active ? optionRefs.current.get(active.id) : undefined;
    if (typeof option?.scrollIntoView === "function") {
      option.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, results]);

  const cancel = () => {
    setOpen(false);
    setActiveIndex(-1);
    setDraft(selected.name);
    onEditingChange?.(false);
  };

  const closeAfterBlur = () => {
    setOpen(false);
    setActiveIndex(-1);
    if (draft.trim() === "" || draft === selected.name) {
      setDraft(selected.name);
      onEditingChange?.(false);
    }
  };

  const commit = (place: Place) => {
    onSelect(place);
    setDraft(place.name);
    setOpen(false);
    setActiveIndex(-1);
    onEditingChange?.(false);
  };

  return (
    <div
      className="place-combobox"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) closeAfterBlur();
      }}
    >
      <label className="place-field" htmlFor={`${id}-search-input`}>
        <span className={`field-dot ${id}`} />
        <span className="field-copy">{label}</span>
        <input
          id={`${id}-search-input`}
          type="search"
          role="combobox"
          aria-label={`${label} 검색`}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={
            activeIndex >= 0 ? `${id}-place-${results[activeIndex]?.id}` : undefined
          }
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          autoComplete="off"
          enterKeyHint="search"
          placeholder="장소·주소를 검색하세요"
          maxLength={100}
          value={draft}
          disabled={disabled}
          onFocus={() => {
            setOpen(true);
            setActiveIndex(-1);
            if (draft === selected.name) setDraft("");
          }}
          onChange={(event) => {
            setDraft(event.target.value);
            setOpen(true);
            setActiveIndex(-1);
            onEditingChange?.(true);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape") {
              event.preventDefault();
              cancel();
              return;
            }
            if (event.key === "ArrowDown" && results.length > 0) {
              event.preventDefault();
              setActiveIndex((index) => (index + 1) % results.length);
              return;
            }
            if (event.key === "ArrowUp" && results.length > 0) {
              event.preventDefault();
              setActiveIndex((index) =>
                index <= 0 ? results.length - 1 : index - 1,
              );
              return;
            }
            if (event.key === "Enter" && activeIndex >= 0) {
              event.preventDefault();
              const place = results[activeIndex];
              if (place) commit(place);
              return;
            }
            if (event.key === "Enter") {
              const normalizedDraft = normalizePlaceQuery(draft);
              const exact = results.find(
                (place) => normalizePlaceQuery(place.name) === normalizedDraft,
              );
              if (exact) {
                event.preventDefault();
                commit(exact);
              }
            }
          }}
        />
      </label>
      {open && (
        <div className="place-search-popover">
          {draft.trim() === "" ? (
            <p className="place-search-message" role="status">
              장소나 주소를 입력해 주세요.
            </p>
          ) : searchPending ? (
            <p className="place-search-message" role="status">
              장소를 찾고 있어요.
            </p>
          ) : results.length === 0 ? (
            <p className="place-search-message" role="status">
              검색 결과가 없어요.
            </p>
          ) : (
            <div id={listboxId} role="listbox" aria-label={`${label} 검색 결과`}>
              {results.map((place, index) => (
                <button
                  id={`${id}-place-${place.id}`}
                  key={place.id}
                  type="button"
                  role="option"
                  aria-label={
                    place.address
                      ? `${place.name}, ${placeDescription(place)}`
                      : place.name
                  }
                  aria-selected={index === activeIndex}
                  tabIndex={-1}
                  ref={(element) => {
                    if (element) optionRefs.current.set(place.id, element);
                    else optionRefs.current.delete(place.id);
                  }}
                  className={index === activeIndex ? "active" : undefined}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => commit(place)}
                >
                  <span>{place.name}</span>
                  <small>{placeDescription(place)}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
