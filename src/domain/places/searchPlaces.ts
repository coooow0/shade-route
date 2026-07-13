import type { Place } from "../routing/types";

const MAX_QUERY_LENGTH = 100;

interface PreparedPlace {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly address: string | null;
}

const preparedPlaces = new WeakMap<Place, PreparedPlace>();

export function normalizePlaceQuery(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\s·.,()\-_/]+/gu, "")
    .toLocaleLowerCase("ko")
    .replace(/역$/u, "");
}

function queryTokens(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko")
    .split(/[\s·.,()\-_/]+/gu)
    .filter(Boolean);
}

function preparePlace(place: Place) {
  const cached = preparedPlaces.get(place);
  if (cached) return cached;
  const prepared = {
    name: normalizePlaceQuery(place.name),
    aliases: (place.aliases ?? []).map(normalizePlaceQuery),
    address: place.address ? normalizePlaceQuery(place.address) : null,
  };
  preparedPlaces.set(place, prepared);
  return prepared;
}

export function preparePlaceSearch(places: readonly Place[]) {
  places.forEach(preparePlace);
}

function matchScore(place: Place, query: string, tokens: readonly string[]) {
  const prepared = preparePlace(place);
  const name = prepared.name;
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;

  for (const alias of prepared.aliases) {
    if (alias === query) return 3;
    if (alias.startsWith(query)) return 4;
    if (alias.includes(query)) return 5;
  }
  if (
    tokens.length > 1 &&
    prepared.aliases.some((alias) =>
      tokens.every((token) => alias.includes(token)),
    )
  ) {
    return 5;
  }

  if (prepared.address) {
    const address = prepared.address;
    if (address === query) return 6;
    if (address.startsWith(query)) return 7;
    if (address.includes(query)) return 8;
  }
  return null;
}

export function searchPlaces(
  places: readonly Place[],
  query: string,
  limit = 8,
): readonly Place[] {
  if (query.length > MAX_QUERY_LENGTH) return [];
  const normalizedQuery = normalizePlaceQuery(query);
  if (!normalizedQuery || limit <= 0) return [];
  const tokens = queryTokens(query).map(normalizePlaceQuery);
  const resultLimit = Math.min(Math.floor(limit), 50);
  const compare = (
    a: { readonly place: Place; readonly score: number },
    b: { readonly place: Place; readonly score: number },
  ) => a.score - b.score || a.place.name.localeCompare(b.place.name, "ko");
  const candidates: Array<{ readonly place: Place; readonly score: number }> = [];

  for (const place of places) {
    const score = matchScore(place, normalizedQuery, tokens);
    if (score === null) continue;
    const candidate = { place, score };
    if (candidates.length < resultLimit) {
      candidates.push(candidate);
      continue;
    }
    let worstIndex = 0;
    for (let index = 1; index < candidates.length; index += 1) {
      if (compare(candidates[index], candidates[worstIndex]) > 0) {
        worstIndex = index;
      }
    }
    if (compare(candidate, candidates[worstIndex]) < 0) {
      candidates[worstIndex] = candidate;
    }
  }
  return candidates.sort(compare).map(({ place }) => place);
}
