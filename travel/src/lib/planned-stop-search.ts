import { sameTripCity } from './cities';
import { directoryKey } from './directory-format';
import { distanceKm } from './distance';
import { placeSearchRadiusKm } from './place-providers';
import { matchesPlaceType, type PlaceTypeFilter } from './place-types';
import { placeNameMatcher, type StopSearchCategory, type StopSearchResult } from './stop-lookup';
import type { DirectoryRef, PlannedStop, TripCityLocation } from './types';

export interface SearchCity {
  index: number;
  name: string;
  location?: TripCityLocation | null;
}

/** Distinguish namesakes and return visits using their positions in the trip. */
export function searchCityLabel(cities: readonly SearchCity[], index: number): string {
  const city = cities.find((visit) => visit.index === index);
  if (!city) return '';
  const name = directoryKey(city.name);
  if (!cities.some((visit) => visit.index !== index && directoryKey(visit.name) === name))
    return city.name;
  return [city.name, city.location?.country_code, `City ${index + 1}`].filter(Boolean).join(' · ');
}

export function sameDirectoryPlace(
  ref: DirectoryRef | undefined,
  place: StopSearchResult,
): boolean {
  if (!ref) return false;
  if (ref.provider === place.source && ref.id === place.id) return true;
  const osm_id = ref.provider === 'osm' ? ref.id : ref.osm_ref;
  return Boolean(osm_id && osm_id === (place.source === 'osm' ? place.id : place.osm_ref));
}

export function matchesPlannedPlace(stop: PlannedStop, place: StopSearchResult): boolean {
  if (sameDirectoryPlace(stop.directory_ref, place)) return true;
  if (stop.directory_ref?.provider === place.source) return false;
  return Boolean(
    stop.position &&
      stop.kind === place.kind &&
      directoryKey(stop.title) === directoryKey(place.title) &&
      distanceKm(stop.position, place.position) <= 0.25,
  );
}

type StopCityFields = Pick<PlannedStop, 'day' | 'city' | 'city_id' | 'position'>;

function matchingStopCities(
  stop: StopCityFields,
  cities: readonly SearchCity[],
  day: string,
): readonly SearchCity[] {
  if (stop.city_id) {
    const visits = cities.filter((city) => city.location?.id === stop.city_id);
    if (visits.length) return visits;
  }
  const candidates = cities.filter(
    (city) =>
      (!stop.city_id || !city.location) &&
      (!stop.city || directoryKey(stop.city) === directoryKey(city.name)),
  );
  // An ongoing night can outlast the traveler's city leg. The day alone cannot
  // assign a previous day's check-in to the city on the current day's itinerary.
  if (candidates.length === 1 && (stop.city || (!stop.city_id && stop.day === day)))
    return candidates;
  const position = stop.position;
  if (!position || candidates.some((city) => !city.location)) return [];
  const nearby = candidates.filter(
    (city) => city.location && distanceKm(city.location, position) <= placeSearchRadiusKm(''),
  );
  return nearby.length === 1 ? nearby : [];
}

/** A city ID may identify multiple visits. Only a unique visit has a route position. */
export function plannedStopCityIndex(
  stop: StopCityFields,
  cities: readonly SearchCity[],
  day: string,
): number | undefined {
  const matches = matchingStopCities(stop, cities, day);
  return matches.length === 1 ? matches[0].index : undefined;
}

/** Suggest where a new activity fits among the scheduled city visits on its day. */
export function suggestRouteAnchor(
  cities: readonly SearchCity[],
  route: readonly PlannedStop[],
  candidate: Pick<PlannedStop, 'city' | 'city_id' | 'kind'>,
  day: string,
): string | undefined {
  if (cities.length < 2 || candidate.kind === 'stay' || candidate.kind === 'transport') return;
  const repeats_city = cities.some((city, i) =>
    cities
      .slice(i + 1)
      .some((next) => sameTripCity(city.name, city.location, next.name, next.location)),
  );
  if (repeats_city) return;
  const target = plannedStopCityIndex({ ...candidate, day, position: null }, cities, day);
  if (target === undefined) return;

  let previous_city = -1;
  let previous_unknown = false;
  let anchor: string | undefined;
  for (const stop of route) {
    if (stop.day !== day) continue;
    const city = plannedStopCityIndex(stop, cities, day);
    if (city === undefined) {
      previous_unknown = true;
      continue;
    }
    if (city < previous_city) return;
    if (anchor === undefined && city > target) {
      // An unassigned stop at the boundary could already be part of the next visit.
      if (previous_unknown) return;
      anchor = stop.id;
    }
    previous_city = city;
    previous_unknown = false;
  }
  return anchor;
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
        ? matchingStopCities(stop, cities, day).some((city) => city.index === selected)
        : Boolean(custom_key && stop.city && directoryKey(stop.city) === custom_key)),
  );
}
