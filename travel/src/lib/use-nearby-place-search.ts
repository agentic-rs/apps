import { useMemo } from 'react';
import type { ContinuingStay } from './hotel-stays';
import { searchCityForAnchor } from './planned-stop-search';
import type { PlannedStop, Trip } from './types';
import { searchCities, useSearchCityLocations } from './use-search-cities';

function nearbyCategory(stop: PlannedStop) {
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
  const needs_centers = useMemo(() => {
    if (cities.every((city) => city.location)) return false;
    const needs_city = (stop: PlannedStop) =>
      nearbyCategory(stop) !== undefined && searchCityForAnchor(trip, stop, cities) === undefined;
    return stops.some(needs_city) || stays.some(({ stop }) => needs_city(stop));
  }, [cities, trip, stops, stays]);
  const resolved = useSearchCityLocations(cities, needs_centers);
  return (stop: PlannedStop) => {
    const category = nearbyCategory(stop);
    if (category && searchCityForAnchor(trip, stop, resolved.cities) !== undefined) return category;
  };
}
