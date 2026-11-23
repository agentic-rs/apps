import { useMemo } from 'react';
import { cityIndicesOnDay } from './city-days';
import { plannedStopCityIndex, type SearchCity } from './planned-stop-search';
import type { Place, PlannedStop, Trip } from './types';
import { searchCities, useSearchCityLocations } from './use-search-cities';

/** Propose an editable named place. A stop's pin describes the place, not the visit. */
export function plannedCheckInPlace(
  trip: Trip,
  stop?: PlannedStop,
  scheduled?: SearchCity[],
): Pick<Place, 'name' | 'locality' | 'position'> {
  if (!stop) return { name: '', locality: '', position: null };
  let locality = stop.city ?? '';
  if (!locality) {
    const cities = scheduled ?? searchCities(trip, cityIndicesOnDay(trip, stop.day));
    const index = plannedStopCityIndex(stop, cities, stop.day);
    if (index !== undefined) locality = trip.cities![index];
  }
  return { name: stop.title, locality, position: stop.position };
}

/** Resolve legacy transfer days from the same bundled city data as the stop picker. */
export function usePlannedCheckInPlace(trip: Trip, stop?: PlannedStop) {
  const day = stop?.day;
  const scheduled = useMemo(
    () => (day ? searchCities(trip, cityIndicesOnDay(trip, day)) : []),
    [trip, day],
  );
  const needs_centers =
    !!stop &&
    !stop.city &&
    !!(stop.position || stop.city_id) &&
    (scheduled.length > 1 || !!stop.city_id);
  const { cities, loading } = useSearchCityLocations(scheduled, needs_centers);
  return { place: plannedCheckInPlace(trip, stop, cities), loading };
}
