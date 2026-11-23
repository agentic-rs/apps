import { useEffect, useMemo, useState } from 'react';
import { cityIndicesOnDay } from './city-days';
import { resolveCityTimeZone } from './offline-directory';
import { plannedStopCityIndex, type SearchCity } from './planned-stop-search';
import type { Place, PlannedStop, Trip } from './types';
import { searchCities, useSearchCityLocations } from './use-search-cities';

/** Propose an editable named place. A stop's pin describes the place, not the visit. */
export function plannedCheckInContext(
  trip: Trip,
  stop?: PlannedStop,
  scheduled?: SearchCity[],
): { place: Pick<Place, 'name' | 'locality' | 'position'>; city_id?: string } {
  if (!stop) return { place: { name: '', locality: '', position: null } };
  const cities = scheduled ?? searchCities(trip, cityIndicesOnDay(trip, stop.day));
  const index = plannedStopCityIndex(stop, cities, stop.day);
  const locality = stop.city || (index === undefined ? '' : trip.cities![index]);
  // A center inferred by name helps place a pin on a legacy route, but only a saved ID
  // identifies which namesake the traveler chose. The directory checks ambiguity for other names.
  const city_id =
    stop.city_id ?? (index === undefined ? undefined : trip.city_locations?.[index]?.id);
  return { place: { name: stop.title, locality, position: stop.position }, city_id };
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
  const context = useMemo(() => plannedCheckInContext(trip, stop, cities), [trip, stop, cities]);
  const [zone, setZone] = useState<{ source: typeof context; value?: string }>();
  const { place, city_id } = context;
  const can_resolve_zone = Boolean(city_id || place.locality);
  useEffect(() => {
    if (!can_resolve_zone) return;
    let active = true;
    void resolveCityTimeZone(place.locality, city_id, place.position ?? undefined)
      .catch(() => undefined)
      .then((value) => {
        if (active) setZone({ source: context, value });
      });
    return () => {
      active = false;
    };
  }, [context, can_resolve_zone, place, city_id]);
  return {
    place,
    loading,
    time_zone: zone?.source === context ? zone.value : undefined,
    resolving_zone: (loading && !city_id) || (can_resolve_zone && zone?.source !== context),
  };
}
