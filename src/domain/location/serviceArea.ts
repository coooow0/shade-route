import { SEOUL_BOUNDARY, type BoundaryRing } from "../../data/seoulBoundary";

const isPointInRing = (
  longitude: number,
  latitude: number,
  ring: BoundaryRing,
): boolean => {
  let isInside = false;

  for (
    let currentIndex = 0, previousIndex = ring.length - 1;
    currentIndex < ring.length;
    previousIndex = currentIndex, currentIndex += 1
  ) {
    const [currentLongitude, currentLatitude] = ring[currentIndex];
    const [previousLongitude, previousLatitude] = ring[previousIndex];
    const crossesLatitude = currentLatitude > latitude !== previousLatitude > latitude;
    const crossingLongitude =
      ((previousLongitude - currentLongitude) * (latitude - currentLatitude)) /
        (previousLatitude - currentLatitude) +
      currentLongitude;

    if (crossesLatitude && longitude < crossingLongitude) {
      isInside = !isInside;
    }
  }

  return isInside;
};

export const isWithinSeoul = (latitude: number, longitude: number): boolean => {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return false;
  }

  return SEOUL_BOUNDARY.some(
    ([outerRing, ...holes]) =>
      isPointInRing(longitude, latitude, outerRing) &&
      holes.every((hole) => !isPointInRing(longitude, latitude, hole)),
  );
};
