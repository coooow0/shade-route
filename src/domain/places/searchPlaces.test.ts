import { describe, expect, it } from "vitest";
import { searchPlaces } from "./searchPlaces";
import type { Place } from "../routing/types";

const places: readonly Place[] = [
  { id: "gangnam", name: "강남", lat: 37.498, lon: 127.028 },
  {
    id: "gangnam-office",
    name: "강남구청",
    aliases: ["Gangnam-gu Office"],
    address: "서울 강남구 학동로 426",
    kind: "office",
    lat: 37.517,
    lon: 127.041,
  },
  { id: "jonggak", name: "종각", lat: 37.57, lon: 126.983 },
];

describe("searchPlaces", () => {
  it("matches optional 역 suffix and ranks exact matches first", () => {
    expect(searchPlaces(places, "강남역").map((place) => place.id)).toEqual([
      "gangnam",
      "gangnam-office",
    ]);
  });

  it("normalizes whitespace and returns a bounded immutable result", () => {
    const before = JSON.stringify(places);
    expect(searchPlaces(places, " 강남 구청 ", 1)).toEqual([places[1]]);
    expect(JSON.stringify(places)).toBe(before);
  });

  it("returns no suggestions for an empty query", () => {
    expect(searchPlaces(places, " ")).toEqual([]);
  });

  it("rejects an excessively long query before scanning places", () => {
    const unreadable = {
      id: "unreadable",
      get name(): string {
        throw new Error("PLACE_SHOULD_NOT_BE_SCANNED");
      },
      lat: 37.5,
      lon: 127,
    };
    expect(searchPlaces([unreadable], "가".repeat(101))).toEqual([]);
  });

  it("finds a destination by address and alias", () => {
    expect(searchPlaces(places, "학동로 426")).toEqual([places[1]]);
    expect(searchPlaces(places, "Gangnam Office")).toEqual([places[1]]);
  });

  it("keeps exact name matches ahead of address matches", () => {
    const addressMatch: Place = {
      id: "address-match",
      name: "테스트 빌딩",
      address: "강남로 1",
      kind: "building",
      lat: 37.5,
      lon: 127.03,
    };
    expect(searchPlaces([...places, addressMatch], "강남").map(({ id }) => id)).toEqual([
      "gangnam",
      "gangnam-office",
      "address-match",
    ]);
  });
});
