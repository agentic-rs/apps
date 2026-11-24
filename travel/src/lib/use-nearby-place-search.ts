import { useMemo } from 'react';
import type { ContinuingStay } from './hotel-stays';
import { searchCityForAnchor, searchCityLabel } from './planned-stop-search';
import type { PlannedStop, Trip } from './types';
import { searchCities, useSearchCityLocations } from './use-search-cities';

function categoryForStop(stop: PlannedStop) {
  if (!stop.position) return;
  if (stop.kind === 'stay') return 'sight';
  if (stop.kind === 'sight' || stop.kind === 'transport') return 'stay';
}

/** The map and the itinerary offer the same searches for the same saved place. */
export function useNearbyPlaceSearch(
  trip: Trip,
  stops: readonly PlannedStop[],
  stays: readonly ContinuingStay[],
) {
  const cities = useMemo(() => searchCities(trip), [trip]);
  const day_places = useMemo(() => [...stops, ...stays.map(({ stop }) => stop)], [stops, stays]);
  const needs_centers = useMemo(() => {
    if (cities.every((city) => city.location)) return false;
    return day_places.some(
      (stop) =>
        stop.position &&
        (!stop.city || categoryForStop(stop)) &&
        searchCityForAnchor(trip, stop, cities) === undefined,
    );
  }, [cities, trip, day_places]);
  const { cities: resolved } = useSearchCityLocations(cities, needs_centers);
  const city_by_stop = useMemo(() => {
    const labels = new Map<string, string>();
    for (const stop of day_places) {
      const index = searchCityForAnchor(trip, stop, resolved);
      if (index !== undefined) labels.set(stop.id, searchCityLabel(resolved, index));
    }
    return labels;
  }, [day_places, trip, resolved]);
  return {
    nearbyCategory: (stop: PlannedStop) =>
      city_by_stop.has(stop.id) ? categoryForStop(stop) : undefined,
    nearbyCity: (stop: PlannedStop) => city_by_stop.get(stop.id) ?? stop.city,
  };
}
