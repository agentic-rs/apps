import { useEffect, useMemo, useState } from 'react';
import type { SearchCity } from './planned-stop-search';
import { resolveSearchCity } from './stop-lookup';
import type { Trip } from './types';

export function searchCities(trip: Trip, indices: readonly number[]): SearchCity[] {
  return indices.map((index) => ({
    index,
    name: trip.cities![index],
    location: trip.city_locations?.[index],
  }));
}

/** Older trips only store city names. Resolve their centers from the bundled directory. */
export function useSearchCityLocations(cities: SearchCity[], needed: boolean) {
  const [resolved, setResolved] = useState<{ source: SearchCity[]; cities: SearchCity[] }>();
  const resolve = useMemo(() => {
    let pending: Promise<SearchCity[]> | undefined;
    return () => {
      pending ??= Promise.all(
        cities.map(async (city) => {
          if (city.location) return city;
          const location = await resolveSearchCity(city.name).catch(() => undefined);
          return { ...city, location };
        }),
      );
      return pending;
    };
  }, [cities]);
  const loading = needed && cities.some((city) => !city.location) && resolved?.source !== cities;
  useEffect(() => {
    if (!loading) return;
    let active = true;
    void resolve().then((result) => {
      if (active) setResolved({ source: cities, cities: result });
    });
    return () => {
      active = false;
    };
  }, [cities, loading, resolve]);
  return { cities: resolved?.source === cities ? resolved.cities : cities, resolve, loading };
}
