import { formatDistance } from './distance';
import type { ContinuingStay } from './hotel-stays';
import { nearestDayPlace } from './map';
import { matchesPlannedPlace } from './planned-stop-search';
import type { StopSearchResult } from './stop-lookup';
import type { PlannedStop } from './types';

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
): DayPlaceResult {
  const planned = day_stops.filter((stop) => matchesPlannedPlace(stop, place));
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
