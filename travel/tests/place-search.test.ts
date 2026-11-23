import { expect, spyOn, test } from 'bun:test';
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

test('browses named places near the city without a text query on either provider', () => {
  const sights = placeSearchUrl('', 'sight', 'Nara', nara, '');
  expect(sights.pathname).toBe('/reverse');
  expect(sights.searchParams.has('q')).toBe(false);
  expect(sights.searchParams.get('radius')).toBe('10');
  expect(sights.searchParams.get('lon')).toBe(String(nara.longitude));
  expect(sights.searchParams.getAll('osm_tag')).toContain('tourism:museum');
  expect(sights.searchParams.getAll('osm_tag')).not.toContain('tourism');
  const hotels = placeSearchUrl('', 'stay', 'Nara', nara, '');
  expect(hotels.searchParams.getAll('osm_tag')).toContain('tourism:hotel');
  const geo = placeSearchUrl('', 'stay', 'Nara', nara, 'test');
  expect(geo.searchParams.get('categories')).toBe('accommodation');
  expect(geo.searchParams.has('name')).toBe(false);
  expect(geo.searchParams.get('conditions')).toBe('named');
  expect(geo.searchParams.get('filter')).toBe('circle:135.833,34.685,10000');
  expect(geo.searchParams.get('bias')).toBe('proximity:135.833,34.685');
});

test('sight results exclude visitor information, lodging and irrelevant facilities', () => {
  const osm = (value: string) => ({
    geometry: point,
    properties: { ...hotel, osm_value: value },
  });
  const geo = (category: string) => ({
    geometry: point,
    properties: { name: 'A place', place_id: category, categories: [category] },
  });
  for (const value of ['hotel', 'information', 'camp_site'])
    expect(readPlaceResults({ features: [osm(value)] }, false, 'sight')).toEqual([]);
  for (const value of ['accommodation.hotel', 'tourism.information.map', 'leisure.spa'])
    expect(readPlaceResults({ features: [geo(value)] }, true, 'sight')).toEqual([]);
  expect(readPlaceResults({ features: [osm('museum')] }, false, 'sight')).toHaveLength(1);
  expect(
    readPlaceResults({ features: [geo('tourism.sights.castle')] }, true, 'sight'),
  ).toHaveLength(1);
});

test('keeps nearby browsing inside ten kilometers while named searches can reach further', async () => {
  const lookup = createStopLookup(false, '');
  const signal = new AbortController().signal;
  const fetch_spy = spyOn(globalThis, 'fetch');
  try {
    const local = { properties: hotel, geometry: point };
    const distant = {
      properties: { ...hotel, osm_id: 22 },
      geometry: { type: 'Point', coordinates: [135.833, 34.85] },
    };
    const payload = { features: [local, distant] };
    fetch_spy
      .mockResolvedValueOnce(Response.json(payload))
      .mockResolvedValueOnce(Response.json(payload));
    const request = { category: 'stay' as const, city: 'Nara', location: nara };
    expect(await lookup.search({ ...request, query: ' ' }, signal)).toHaveLength(1);
    expect(await lookup.search({ ...request, query: 'Test Inn' }, signal)).toHaveLength(2);
  } finally {
    fetch_spy.mockRestore();
  }
});

test('requires a resolved city center to browse and skips blank searches in other categories', async () => {
  const lookup = createStopLookup(false, '');
  const signal = new AbortController().signal;
  const fetch_spy = spyOn(globalThis, 'fetch');
  try {
    for (const key of ['', 'test']) {
      expect(() => placeSearchUrl('', 'sight', 'A custom village', undefined, key)).toThrow(
        'Choose a city from the directory',
      );
    }
    await expect(lookup.search({ query: '', city: '', category: 'stay' }, signal)).rejects.toThrow(
      'Choose a city from the directory',
    );
    for (const category of ['all', 'food', 'airport'] as const)
      expect(await lookup.search({ query: '', city: 'Nara', category }, signal)).toEqual([]);
    expect(fetch_spy).not.toHaveBeenCalled();
  } finally {
    fetch_spy.mockRestore();
  }
});

test('an aborted search never starts an online lookup', async () => {
  const signal = AbortSignal.abort();
  const lookup = createStopLookup(false, '');
  await expect(
    lookup.search({ query: 'park', category: 'sight', city: 'Nara', location: nara }, signal),
  ).rejects.toThrow();
});
