import { searchDirectoryAirports, searchDirectoryCities } from './offline-directory';
import { distanceKm } from './distance';
import { placeSearchRadiusKm, placeSearchUrl, readPlaceResults } from './place-providers';
import type { Coordinates, DirectoryRef, StopKind, TripCityLocation } from './types';

export type StopSearchCategory = 'all' | 'sight' | 'food' | 'stay' | 'airport';
export interface StopSearchRequest {
  query: string;
  city: string;
  location?: TripCityLocation | null;
  category: StopSearchCategory;
}
export interface StopSearchResult {
  id: string;
  title: string;
  subtitle: string;
  source: DirectoryRef['provider'];
  kind: StopKind;
  position: Coordinates;
}
export interface StopLookup {
  attribution: 'Geoapify' | 'Photon';
  search(request: StopSearchRequest, signal: AbortSignal): Promise<StopSearchResult[]>;
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
  return {
    attribution: public_key ? 'Geoapify' : 'Photon',
    async search({ query, category, city, location }, signal) {
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
      // Older trips store names only. Prefer an exact directory match and
      // retain the city text in the remote query if it is a custom location.
      const center =
        location ??
        (city ? (await searchDirectoryCities(city)).find((match) => match.exact_match) : undefined);
      signal.throwIfAborted();
      const url = placeSearchUrl(query, category, city, center, public_key);
      const payload = await requestPlaces(url, signal, native);
      const radius_km = placeSearchRadiusKm(query);
      return readPlaceResults(payload, Boolean(public_key), category).filter(
        (place) => !center || distanceKm(center, place.position) <= radius_km,
      );
    },
  };
}
