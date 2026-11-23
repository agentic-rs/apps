import { searchDirectoryAirports, searchDirectoryCities } from './offline-directory';
import { distanceKm } from './distance';
import { directoryKey } from './directory-format';
import { placeTypeLabel, type PlaceType, type PlaceTypeFilter } from './place-types';
import {
  named_search_radius_km,
  placeSearchRadiusKm,
  placeSearchUrl,
  readPlaceResults,
} from './place-providers';
import type { Coordinates, DirectoryRef, StopKind, Trip, TripCityLocation } from './types';

export type StopSearchCategory = 'all' | 'sight' | 'food' | 'stay' | 'airport';
export interface StopSearchRequest {
  query: string;
  city: string;
  location?: TripCityLocation | null;
  category: StopSearchCategory;
  type_filter?: PlaceTypeFilter;
}
export interface StopSearchResult {
  id: string;
  title: string;
  subtitle: string;
  source: DirectoryRef['provider'];
  kind: StopKind;
  place_type?: PlaceType;
  position: Coordinates;
  locality?: string;
  country_code?: string;
  distance_km?: number;
}
export interface StopLookup {
  attribution: 'Geoapify' | 'Photon';
  search(request: StopSearchRequest, signal: AbortSignal): Promise<StopSearchResult[]>;
}

export function filterNearbyPlaces(places: StopSearchResult[], query: string): StopSearchResult[] {
  const matches = placeNameMatcher(query);
  return places.filter((place) =>
    matches(
      [place.title, place.subtitle, place.place_type && placeTypeLabel(place.place_type)].join(' '),
    ),
  );
}

export function placeNameMatcher(query: string): (value: string) => boolean {
  const tokens = directoryKey(query).split(' ').filter(Boolean);
  return (value) => {
    const label = directoryKey(value);
    return tokens.length > 0 && tokens.every((token) => label.includes(token));
  };
}

export async function resolveSearchCity(city: string) {
  return city ? (await searchDirectoryCities(city)).find((match) => match.exact_match) : undefined;
}

/** A day trip to an unlisted town still belongs to the selected itinerary city. */
export function groupPlacesForCity(
  places: StopSearchResult[],
  trip: Pick<Trip, 'cities' | 'city_locations'>,
  options: number[],
  selected: number,
): { places: StopSearchResult[]; other_cities: number[] } {
  if (options.length < 2) return { places, other_cities: [] };
  const scopes = options.map((index) => ({
    index,
    name: directoryKey(trip.cities?.[index] ?? ''),
    location: trip.city_locations?.[index],
  }));
  const selected_id = trip.city_locations?.[selected]?.id;
  const other_cities = new Set<number>();
  const visible = places.filter((place) => {
    if (!place.locality) return true;
    const locality = directoryKey(place.locality);
    if (!locality) return true;
    const matches = scopes.filter(({ name, location }) => {
      if (name !== locality) return false;
      if (!location) return true;
      if (place.country_code && location.country_code !== place.country_code) return false;
      return distanceKm(location, place.position) <= named_search_radius_km;
    });
    if (
      !matches.length ||
      matches.some(
        ({ index, location }) =>
          index === selected || (selected_id && location?.id === selected_id),
      )
    )
      return true;
    // An ambiguous namesake cannot offer a specific destination for the search.
    if (matches.length === 1) other_cities.add(matches[0].index);
    return false;
  });
  return { places: visible, other_cities: options.filter((index) => other_cities.has(index)) };
}

async function requestPlaces(url: URL, signal: AbortSignal, native: boolean): Promise<unknown> {
  // The opaque Apell frame uses the host HTTP capability for external requests.
  let status: number;
  let body: string;
  try {
    if (native) {
      const { http } = await import('@apell/sdk');
      signal.throwIfAborted();
      const response = await http.request({
        url: url.href,
        timeout_ms: 12_000,
        headers: [{ name: 'Accept', value: 'application/json' }],
      });
      status = response.status;
      body = new TextDecoder().decode(Uint8Array.from(response.body));
    } else {
      const response = await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
        referrerPolicy: 'no-referrer',
        credentials: 'omit',
      });
      status = response.status;
      body = await response.text();
    }
  } catch {
    signal.throwIfAborted();
    throw new Error(
      'Could not reach place search. Check your connection or enter the stop manually.',
    );
  }
  signal.throwIfAborted();
  if (status === 429) throw new Error('Place search is busy. Try again shortly.');
  if (status < 200 || status >= 300)
    throw new Error('The place service is unavailable. Try again or enter the stop manually.');
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('The place service returned an unreadable result.');
  }
}

export function createStopLookup(
  native: boolean,
  public_key = import.meta.env?.VITE_GEOAPIFY_PUBLIC_KEY?.trim() ?? '',
): StopLookup {
  // Sheet dismissal should not make comparing another stop in the same city wait on the network.
  const cache = new Map<string, { expires_at: number; places: StopSearchResult[] }>();
  return {
    attribution: public_key ? 'Geoapify' : 'Photon',
    async search({ query, category, type_filter, city, location }, signal) {
      query = query.trim();
      signal.throwIfAborted();
      if (!query && category !== 'sight' && category !== 'stay') return [];
      if (category === 'airport') {
        const airports = await searchDirectoryAirports(query);
        signal.throwIfAborted();
        return airports.map((airport) => ({
          id: airport.id,
          source: 'ourairports',
          kind: 'transport',
          title: airport.name,
          subtitle: [
            airport.iata_code,
            airport.icao_code,
            airport.municipality,
            airport.country_code,
          ]
            .filter(Boolean)
            .join(' · '),
          position: { latitude: airport.latitude, longitude: airport.longitude },
        }));
      }
      const key = JSON.stringify([
        category,
        type_filter,
        city,
        location?.id,
        location?.latitude,
        location?.longitude,
        query,
      ]);
      const cached = cache.get(key);
      if (cached && cached.expires_at > Date.now()) return cached.places;
      if (globalThis.navigator?.onLine === false)
        throw new Error('You’re offline. Search airports or enter a stop manually.');
      // Older trips store names only. Prefer an exact directory match and
      // retain the city text in the remote query if it is a custom location.
      const center = location ?? (await resolveSearchCity(city));
      signal.throwIfAborted();
      const url = placeSearchUrl(query, category, city, center, public_key, type_filter);
      const payload = await requestPlaces(url, signal, native);
      signal.throwIfAborted();
      const radius_km = placeSearchRadiusKm(query);
      const places = readPlaceResults(payload, Boolean(public_key), category, type_filter).flatMap(
        (place) => {
          if (!center) return [place];
          const distance_km = distanceKm(center, place.position);
          return distance_km <= radius_km ? [{ ...place, distance_km }] : [];
        },
      );
      cache.delete(key);
      if (cache.size >= 40) cache.delete(cache.keys().next().value!);
      cache.set(key, { expires_at: Date.now() + 5 * 60_000, places });
      return places;
    },
  };
}
