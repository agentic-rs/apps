import { expect, test } from 'bun:test';
import { placeSearchUrl, readPlaceResults } from '../src/lib/place-providers';
import { createStopLookup } from '../src/lib/stop-lookup';

const nara = { latitude: 34.685, longitude: 135.833, country_code: 'JP', id: 'geonames:1855612' };
const point = { type: 'Point', coordinates: [135.832, 34.683] };
const hotel = {
  osm_id: 21,
  osm_type: 'W',
  osm_key: 'tourism',
  osm_value: 'hotel',
  name: 'Test Inn',
  city: 'Nara',
};

test('uses the chosen city, category and literal query for each provider', () => {
  const photon = placeSearchUrl('日本 & inn', 'stay', 'Nara', nara, '');
  expect(photon.searchParams.get('q')).toBe('日本 & inn');
  expect(photon.searchParams.get('lat')).toBe(String(nara.latitude));
  expect(photon.searchParams.getAll('osm_tag')).toContain('tourism:hotel');
  const custom = placeSearchUrl('Temple', 'all', 'A custom village', undefined, '');
  expect(custom.searchParams.get('q')).toContain('A custom village');
  const at_dateline = placeSearchUrl(
    'Temple',
    'sight',
    'Test',
    { latitude: 1, longitude: 179.9 },
    '',
  );
  expect(at_dateline.searchParams.has('bbox')).toBe(false);
  const geo = placeSearchUrl('日本 & inn', 'stay', 'Nara', nara, 'test');
  expect(geo.searchParams.get('filter')).toBe('circle:135.833,34.685,40000');
  expect(geo.searchParams.get('name')).toBe('日本 & inn');
  expect(geo.searchParams.get('categories')).toBe('accommodation');
});

test('validates, deduplicates and classifies map points retrieved from either provider', () => {
  const feature = { properties: hotel, geometry: point };
  const payload = {
    features: [
      feature,
      feature,
      { properties: hotel, geometry: { type: 'Point', coordinates: [1000, 90] } },
      {},
    ],
  };
  expect(readPlaceResults(payload, false, 'all')).toEqual([
    {
      id: 'W21',
      title: 'Test Inn',
      kind: 'stay',
      source: 'osm',
      subtitle: 'Nara',
      position: { latitude: 34.683, longitude: 135.832 },
    },
  ]);
  expect(readPlaceResults(payload, false, 'sight')).toEqual([]);
  const geo = {
    properties: { name: 'Test Inn', place_id: 'fixture', categories: ['accommodation.hotel'] },
    geometry: point,
  };
  expect(readPlaceResults({ features: [geo] }, true, 'stay')[0]).toMatchObject({
    id: 'fixture',
    source: 'geoapify',
    kind: 'stay',
  });
  expect(() => readPlaceResults({}, false, 'all')).toThrow('unreadable');
});

test('an aborted search never starts an online lookup', async () => {
  const signal = AbortSignal.abort();
  const lookup = createStopLookup(false, '');
  await expect(
    lookup.search({ query: 'park', category: 'sight', city: 'Nara', location: nara }, signal),
  ).rejects.toThrow();
});
