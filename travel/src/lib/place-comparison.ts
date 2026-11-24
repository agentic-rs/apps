import { directoryKey } from './directory-format';
import { distanceKm, formatDistance } from './distance';
import type { ContinuingStay } from './hotel-stays';
import { nearestDayPlace } from './map';
import { matchesPlannedPlace, searchCityForAnchor, type SearchCity } from './planned-stop-search';
import type { StopSearchResult } from './stop-lookup';
import type { Coordinates, PlannedStop, Trip } from './types';

export interface DaySearchArea {
  id: string;
  title: string;
  detail: string;
  position: Coordinates;
}

export function daySearchPlaces(
  trip: Trip,
  route: readonly PlannedStop[],
  stays: readonly ContinuingStay[],
  all_cities: readonly SearchCity[],
  day: string,
) {
  function entry(stop: PlannedStop, detail: string) {
    return { stop, detail, city_index: searchCityForAnchor(trip, stop, all_cities) };
  }
  return [
    ...route.map((stop, index) =>
      entry(stop, `Stop ${index + 1}${stop.kind === 'stay' ? ' · Check-in' : ''}`),
    ),
    ...stays.map(({ stop }) =>
      entry(stop, stop.checkout_date === day ? 'Checking out today' : 'Overnight stay'),
    ),
  ];
}

export function daySearchAreas(
  places: ReturnType<typeof daySearchPlaces>,
  city_index: number | undefined,
  city: string,
): DaySearchArea[] {
  return places.flatMap(({ stop, detail, city_index: visit }) => {
    const belongs =
      city_index === undefined
        ? Boolean(city && stop.city && directoryKey(stop.city) === directoryKey(city))
        : visit === city_index;
    return belongs && stop.position
      ? [{ id: stop.id, title: stop.title, detail, position: stop.position }]
      : [];
  });
}

export interface DayPlaceResult {
  place: StopSearchResult;
  planned: PlannedStop[];
  distance_label?: string;
  route_km?: number;
}

/** The checkout hotel is still on the day map after its last occupied night. */
export function dayPlaceResult(
  place: StopSearchResult,
  day_stops: readonly PlannedStop[],
  route: readonly PlannedStop[],
  stays: readonly ContinuingStay[],
  compare_route: boolean,
  area?: DaySearchArea,
): DayPlaceResult {
  const planned = day_stops.filter((stop) => matchesPlannedPlace(stop, place));
  if (area) {
    const km = distanceKm(place.position, area.position);
    return {
      place,
      planned,
      distance_label: planned.some((stop) => stop.id === area.id)
        ? undefined
        : `${formatDistance(km)} straight line to ${area.title}`,
      route_km: planned.length ? undefined : km,
    };
  }
  const closest =
    compare_route && !planned.length ? nearestDayPlace(place.position, route, stays) : undefined;
  let distance_label: string | undefined;
  if (closest) {
    const anchor = closest.number === undefined ? 'hotel' : 'stop ' + closest.number;
    distance_label = `${formatDistance(closest.km)} straight line to ${anchor} · ${closest.title}`;
  } else if (place.distance_km !== undefined) {
    distance_label = `${formatDistance(place.distance_km)} from city center`;
  }
  return { place, planned, distance_label, route_km: closest?.km };
}

/** Keep ties in directory order and place already-scheduled matches after new candidates. */
export function nearestFirst(a: DayPlaceResult, b: DayPlaceResult): number {
  if (a.route_km === undefined) return b.route_km === undefined ? 0 : 1;
  if (b.route_km === undefined) return -1;
  return a.route_km - b.route_km;
}
