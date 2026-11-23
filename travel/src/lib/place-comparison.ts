import { directoryKey } from './directory-format';
import { distanceKm, formatDistance } from './distance';
import type { ContinuingStay } from './hotel-stays';
import { nearestDayPlace } from './map';
import { matchesPlannedPlace, plannedStopCityIndex, type SearchCity } from './planned-stop-search';
import type { StopSearchResult } from './stop-lookup';
import type { Coordinates, PlannedStop } from './types';

export interface DaySearchArea {
  id: string;
  title: string;
  detail: string;
  position: Coordinates;
}

export function daySearchAreas(
  route: readonly PlannedStop[],
  stays: readonly ContinuingStay[],
  cities: readonly SearchCity[],
  city_index: number | undefined,
  city: string,
  day: string,
): DaySearchArea[] {
  const areas: DaySearchArea[] = [];
  function include(stop: PlannedStop, detail: string) {
    if (!stop.position) return;
    const belongs =
      city_index === undefined
        ? Boolean(city && stop.city && directoryKey(stop.city) === directoryKey(city))
        : plannedStopCityIndex(stop, cities, day) === city_index;
    if (belongs) areas.push({ id: stop.id, title: stop.title, detail, position: stop.position });
  }
  route.forEach((stop, index) =>
    include(stop, `Stop ${index + 1}${stop.kind === 'stay' ? ' · Check-in' : ''}`),
  );
  stays.forEach(({ stop }) =>
    include(stop, stop.checkout_date === day ? 'Checking out today' : 'Overnight stay'),
  );
  return areas;
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
