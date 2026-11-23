import { directoryKey } from './directory-format';
import { distanceKm } from './distance';
import { placeSearchRadiusKm } from './place-providers';
import { matchesPlaceType, type PlaceTypeFilter } from './place-types';
import { placeNameMatcher, type StopSearchCategory, type StopSearchResult } from './stop-lookup';
import type { PlannedStop, TripCityLocation } from './types';

export interface SearchCity {
  index: number;
  name: string;
  location?: TripCityLocation | null;
}

export function matchesPlannedPlace(stop: PlannedStop, place: StopSearchResult): boolean {
  if (stop.directory_ref?.provider === place.source) return stop.directory_ref.id === place.id;
  return Boolean(
    stop.position &&
      stop.kind === place.kind &&
      directoryKey(stop.title) === directoryKey(place.title) &&
      distanceKm(stop.position, place.position) <= 0.25,
  );
}

/** A legacy stop without a city can only be attributed to one nearby day city. */
function belongsToCity(
  stop: PlannedStop,
  cities: SearchCity[],
  selected: number,
  day: string,
): boolean {
  if (stop.city_id && cities.some((city) => city.location?.id === stop.city_id))
    return cities.some((city) => city.index === selected && city.location?.id === stop.city_id);
  const candidates = cities.filter(
    (city) =>
      (!stop.city_id || !city.location) &&
      (!stop.city || directoryKey(stop.city) === directoryKey(city.name)),
  );
  // An ongoing night can outlast the traveler's city leg. The day alone cannot
  // assign a previous day's check-in to the city on the current day's itinerary.
  if (candidates.length === 1 && (stop.city || (!stop.city_id && stop.day === day)))
    return candidates[0].index === selected;
  const position = stop.position;
  if (!position || candidates.some((city) => !city.location)) return false;
  const nearby = candidates.filter(
    (city) => city.location && distanceKm(city.location, position) <= placeSearchRadiusKm(''),
  );
  return nearby.length === 1 && nearby[0].index === selected;
}

export function searchPlannedStops(
  stops: PlannedStop[],
  query: string,
  category: StopSearchCategory,
  cities: SearchCity[],
  selected: number | undefined,
  day: string,
  custom_city = '',
  type_filter?: PlaceTypeFilter,
) {
  const browse_type = Boolean(type_filter) && !query.trim();
  const matches = placeNameMatcher(query);
  const custom_key = directoryKey(custom_city);
  return stops.filter(
    (stop) =>
      (category === 'all' || stop.kind === category) &&
      (!type_filter || matchesPlaceType(stop.directory_ref?.place_type, type_filter)) &&
      (browse_type || matches(stop.title)) &&
      (selected !== undefined
        ? belongsToCity(stop, cities, selected, day)
        : Boolean(custom_key && stop.city && directoryKey(stop.city) === custom_key)),
  );
}
