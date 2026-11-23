import type { Coordinates, StopKind } from './types';
import type { StopSearchCategory, StopSearchResult } from './stop-lookup';

type PlaceCategory = Exclude<StopSearchCategory, 'airport'>;
const tags: Record<PlaceCategory, string[]> = {
  all: [],
  sight: [
    'tourism',
    'historic',
    'amenity:place_of_worship',
    'leisure:park',
    'leisure:garden',
    'natural',
  ],
  food: [
    'amenity:restaurant',
    'amenity:cafe',
    'amenity:fast_food',
    'amenity:bar',
    'amenity:food_court',
    'amenity:pub',
    'shop:bakery',
  ],
  stay: [
    'tourism:hotel',
    'tourism:hostel',
    'tourism:guest_house',
    'tourism:motel',
    'tourism:apartment',
    'tourism:resort',
  ],
};
const categories: Record<PlaceCategory, string> = {
  all: 'accommodation,activity,catering,commercial,entertainment,heritage,leisure,natural,public_transport,religion,tourism',
  sight: 'tourism,entertainment.museum,heritage,religion,leisure.park,natural',
  stay: 'accommodation',
  food: 'catering,commercial.food_and_drink.bakery',
};
const radius_m = 40_000;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function string(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function placeSearchUrl(
  query: string,
  category: PlaceCategory,
  city: string,
  center: Coordinates | undefined,
  public_key: string,
): URL {
  if (public_key) {
    if (!center)
      throw new Error(
        'Choose a city from the directory to search nearby, or enter the stop manually.',
      );
    const url = new URL('https://api.geoapify.com/v2/places');
    url.search = new URLSearchParams({
      name: query,
      categories: categories[category],
      limit: '12',
      lang: 'en',
      filter: `circle:${center.longitude},${center.latitude},${radius_m}`,
      bias: `proximity:${center.longitude},${center.latitude}`,
      apiKey: public_key,
    }).toString();
    return url;
  }
  const url = new URL('https://photon.komoot.io/api/');
  url.search = new URLSearchParams({
    q: center ? query : [query, city].filter(Boolean).join(', '),
    limit: '12',
    lang: 'en',
  }).toString();
  if (center) {
    const { latitude, longitude } = center;
    const dy = radius_m / 111_000;
    const dx = dy / Math.max(0.001, Math.cos((latitude * Math.PI) / 180));
    url.searchParams.set('lat', String(latitude));
    url.searchParams.set('lon', String(longitude));
    // A wrapped bounding box is invalid for Photon. In that case the caller
    // still applies the same distance filter to the biased results.
    if (longitude - dx >= -180 && longitude + dx <= 180)
      url.searchParams.set(
        'bbox',
        [
          longitude - dx,
          Math.max(-90, latitude - dy),
          longitude + dx,
          Math.min(90, latitude + dy),
        ].join(','),
      );
  }
  for (const tag of tags[category]) url.searchParams.append('osm_tag', tag);
  return url;
}

function osmKind(key: string, value: string): StopKind {
  const tag = key + ':' + value;
  if (tags.stay.includes(tag)) return 'stay';
  if (tags.food.includes(tag)) return 'food';
  if (['railway', 'aeroway', 'public_transport'].includes(key) || value === 'bus_station')
    return 'transport';
  if (tags.sight.includes(key) || tags.sight.includes(tag)) return 'sight';
  return 'other';
}

function geoapifyKind(values: unknown): StopKind {
  const values_list = Array.isArray(values) ? values.map(string) : [];
  const roots = new Set(values_list.map((value) => value.split('.')[0]));
  if (roots.has('accommodation')) return 'stay';
  if (roots.has('catering') || values_list.includes('commercial.food_and_drink.bakery'))
    return 'food';
  if (roots.has('public_transport') || roots.has('airport')) return 'transport';
  if (
    ['tourism', 'entertainment', 'leisure', 'heritage', 'religion', 'natural'].some((key) =>
      roots.has(key),
    )
  )
    return 'sight';
  return 'other';
}

export function readPlaceResults(
  payload: unknown,
  geoapify: boolean,
  category: PlaceCategory,
): StopSearchResult[] {
  const features = asObject(payload).features;
  if (!Array.isArray(features)) throw new Error('The place service returned an unreadable result.');
  const results = new Map<string, StopSearchResult>();
  for (const feature of features) {
    const row = asObject(feature);
    const props = asObject(row.properties);
    const geometry = asObject(row.geometry);
    if (geometry.type !== 'Point' || !Array.isArray(geometry.coordinates)) continue;
    const [longitude, latitude] = geometry.coordinates;
    if (
      !Number.isFinite(longitude) ||
      Math.abs(longitude) > 180 ||
      !Number.isFinite(latitude) ||
      Math.abs(latitude) > 90
    )
      continue;
    const title = string(props.name);
    if (!title || title.length > 200) continue;
    const id = geoapify
      ? string(props.place_id)
      : /^[NWR]$/.test(string(props.osm_type)) && Number.isSafeInteger(props.osm_id)
        ? `${props.osm_type}${props.osm_id}`
        : '';
    if (!id || id.length > 512 || results.has(id)) continue;
    const kind = geoapify
      ? geoapifyKind(props.categories)
      : osmKind(string(props.osm_key), string(props.osm_value));
    // Broad upstream tags such as "tourism" also include hotels.
    if (category !== 'all' && category !== kind) continue;
    const locality = [
      string(props.street),
      string(props.city) || string(props.town),
      string(props.country),
    ].filter(Boolean);
    results.set(id, {
      id,
      title,
      subtitle: [...new Set(locality)].join(', '),
      source: geoapify ? 'geoapify' : 'osm',
      kind,
      position: { latitude, longitude },
    });
  }
  return [...results.values()];
}

export const search_radius_km = radius_m / 1000;
