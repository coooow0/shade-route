import {
  SEOUL_BOUNDARY,
  type BoundaryPosition,
  type BoundaryRing,
} from "../../data/seoulBoundary";

const LATITUDE_BUCKETS = 128;

interface RingEdge {
  readonly current: BoundaryPosition;
  readonly previous: BoundaryPosition;
  readonly minimumLatitude: number;
  readonly maximumLatitude: number;
}

interface IndexedRing {
  readonly minimumLongitude: number;
  readonly maximumLongitude: number;
  readonly minimumLatitude: number;
  readonly maximumLatitude: number;
  readonly latitudeSpan: number;
  readonly buckets: ReadonlyArray<ReadonlyArray<RingEdge>>;
}

function indexRing(ring: BoundaryRing): IndexedRing {
  const longitudes = ring.map(([longitude]) => longitude);
  const latitudes = ring.map(([, latitude]) => latitude);
  const minimumLongitude = Math.min(...longitudes);
  const maximumLongitude = Math.max(...longitudes);
  const minimumLatitude = Math.min(...latitudes);
  const maximumLatitude = Math.max(...latitudes);
  const latitudeSpan = maximumLatitude - minimumLatitude || 1;
  const edges = ring.map((current, index): RingEdge => {
    const previous = ring[index === 0 ? ring.length - 1 : index - 1];
    return {
      current,
      previous,
      minimumLatitude: Math.min(current[1], previous[1]),
      maximumLatitude: Math.max(current[1], previous[1]),
    };
  });
  const bucketHeight = latitudeSpan / LATITUDE_BUCKETS;
  const buckets = Array.from({ length: LATITUDE_BUCKETS }, (_, index) => {
    const bucketMinimum = minimumLatitude + bucketHeight * index;
    const bucketMaximum =
      index === LATITUDE_BUCKETS - 1
        ? maximumLatitude
        : bucketMinimum + bucketHeight;
    return edges.filter(
      (edge) =>
        edge.maximumLatitude >= bucketMinimum &&
        edge.minimumLatitude <= bucketMaximum,
    );
  });

  return {
    minimumLongitude,
    maximumLongitude,
    minimumLatitude,
    maximumLatitude,
    latitudeSpan,
    buckets,
  };
}

const INDEXED_SEOUL_BOUNDARY = SEOUL_BOUNDARY.map(([outerRing, ...holes]) => ({
  outerRing: indexRing(outerRing),
  holes: holes.map(indexRing),
}));

function isPointInRing(
  longitude: number,
  latitude: number,
  ring: IndexedRing,
): boolean {
  if (
    longitude < ring.minimumLongitude ||
    longitude > ring.maximumLongitude ||
    latitude < ring.minimumLatitude ||
    latitude > ring.maximumLatitude
  ) {
    return false;
  }

  const bucketIndex = Math.min(
    LATITUDE_BUCKETS - 1,
    Math.max(
      0,
      Math.floor(
        ((latitude - ring.minimumLatitude) / ring.latitudeSpan) *
          LATITUDE_BUCKETS,
      ),
    ),
  );
  let isInside = false;
  for (const edge of ring.buckets[bucketIndex]) {
    const [currentLongitude, currentLatitude] = edge.current;
    const [previousLongitude, previousLatitude] = edge.previous;
    const crossesLatitude =
      currentLatitude > latitude !== previousLatitude > latitude;
    const crossingLongitude =
      ((previousLongitude - currentLongitude) * (latitude - currentLatitude)) /
        (previousLatitude - currentLatitude) +
      currentLongitude;
    if (crossesLatitude && longitude < crossingLongitude) {
      isInside = !isInside;
    }
  }
  return isInside;
}

export const isWithinSeoul = (latitude: number, longitude: number): boolean => {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return false;
  }

  return INDEXED_SEOUL_BOUNDARY.some(
    ({ outerRing, holes }) =>
      isPointInRing(longitude, latitude, outerRing) &&
      holes.every((hole) => !isPointInRing(longitude, latitude, hole)),
  );
};
