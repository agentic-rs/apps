import { expect, spyOn, test } from 'bun:test';
import { placeSearchUrl, readPlaceResults } from '../src/lib/place-providers';
import { createStopLookup, filterNearbyPlaces, groupPlacesForCity } from '../src/lib/stop-lookup';

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
      locality: 'Nara',
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

test('named sights and hotels from the other transfer city appear only under their own chip', () => {
  const leg_cities = { cities: ['Kyoto', 'Nara'] };
  const sight = {
    geometry: { type: 'Point', coordinates: [135.7727, 34.9671] },
    properties: {
      osm_type: 'W',
      osm_id: 1,
      osm_key: 'amenity',
      osm_value: 'place_of_worship',
      name: 'Fushimi Inari Taisha',
      city: 'Kyoto',
      countrycode: 'JP',
    },
  };
  const stay = {
    geometry: { type: 'Point', coordinates: [135.804, 34.684] },
    properties: {
      place_id: 'hotel',
      name: 'JW Marriott Hotel Nara',
      city: 'Nara',
      country_code: 'jp',
      categories: ['accommodation.hotel'],
    },
  };
  const [temple] = readPlaceResults({ features: [sight] }, false, 'sight');
  const [hotel] = readPlaceResults({ features: [stay] }, true, 'stay');
  expect(temple).toMatchObject({ locality: 'Kyoto', country_code: 'JP' });
  expect(hotel).toMatchObject({ locality: 'Nara', country_code: 'JP' });
  const places = [temple, hotel];
  expect(groupPlacesForCity(places, leg_cities, [0, 1], 0)).toEqual({
    places: [temple],
    other_cities: [1],
  });
  expect(groupPlacesForCity(places, leg_cities, [0, 1], 1)).toEqual({
    places: [hotel],
    other_cities: [0],
  });
  expect(groupPlacesForCity(places, leg_cities, [1], 1)).toEqual({ places, other_cities: [] });
});

test('preserves excursions, unconfirmed translations, and place names containing another city', () => {
  const [place] = readPlaceResults(
    {
      features: [
        {
          properties: { ...hotel, name: 'Kyoto Road Guesthouse', city: '', street: 'Kyoto' },
          geometry: point,
        },
      ],
    },
    false,
    'stay',
  );
  const route = { cities: ['Kyōto', '奈良'] };
  const nearby = [
    place,
    ...['Uji', 'Kyototanabe', '京都市', '奈良'].map((locality) => ({ ...place, locality })),
  ];
  const other_city = { ...place, locality: 'Kyoto' };
  expect(groupPlacesForCity([...nearby, other_city], route, [0, 1], 1)).toEqual({
    places: nearby,
    other_cities: [0],
  });
});

test('checks known country and location for namesakes and retains repeated visits to one city', () => {
  const [place] = readPlaceResults(
    {
      features: [
        {
          properties: { ...hotel, city: '', town: 'Nara', countrycode: 'jp' },
          geometry: point,
        },
      ],
    },
    false,
    'stay',
  );
  const namesake = { id: 'other-nara', country_code: 'US', latitude: 34.7, longitude: 135.8 };
  const remote = { ...nara, id: 'distant-nara', latitude: 20 };
  const route = {
    cities: ['Nara', 'Nara', 'Nara', '奈良'],
    city_locations: [namesake, remote, nara, nara],
  };
  const options = [0, 1, 2, 3];
  expect(groupPlacesForCity([place], route, options, 0)).toEqual({ places: [], other_cities: [2] });
  expect(groupPlacesForCity([place], route, options, 1)).toEqual({ places: [], other_cities: [2] });
  expect(groupPlacesForCity([place], route, options, 2)).toEqual({
    places: [place],
    other_cities: [],
  });
  expect(groupPlacesForCity([place], route, options, 3)).toEqual({
    places: [place],
    other_cities: [],
  });
  expect(groupPlacesForCity([place], { cities: ['Nara', 'Nara'] }, [0, 1], 0).places).toEqual([
    place,
  ]);
  expect(groupPlacesForCity([place], { cities: ['Kyoto', 'Nara', 'Nara'] }, [0, 1, 2], 0)).toEqual({
    places: [],
    other_cities: [],
  });
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
    const nearby = await lookup.search({ ...request, query: ' ' }, signal);
    expect(nearby).toHaveLength(1);
    expect(nearby[0].distance_km).toBeCloseTo(0.24, 1);
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

test('matches partial names and localities in any order, including accents and CJK', () => {
  const results = readPlaceResults(
    {
      features: [
        {
          properties: { ...hotel, name: 'Hôtel des Jardins', street: 'Rue du Musée' },
          geometry: point,
        },
        { properties: { ...hotel, osm_id: 22, name: '奈良公園ホテル' }, geometry: point },
      ],
    },
    false,
    'stay',
  );
  expect(filterNearbyPlaces(results, 'MUSE jard').map((place) => place.id)).toEqual(['W21']);
  expect(filterNearbyPlaces(results, '公園').map((place) => place.id)).toEqual(['W22']);
  expect(filterNearbyPlaces(results, 'museum garden')).toEqual([]);
  expect(filterNearbyPlaces(results, '…')).toEqual([]);
});

test('reuses successful results only for the same city, category, query and freshness window', async () => {
  const lookup = createStopLookup(false, '');
  const signal = new AbortController().signal;
  const request = { query: 'Test', city: 'Nara', category: 'stay', location: nara } as const;
  const payload = { features: [{ properties: hotel, geometry: point }] };
  const fetch_spy = spyOn(globalThis, 'fetch');
  for (let response = 0; response < 5; response++)
    fetch_spy.mockResolvedValueOnce(Response.json(payload));
  const now = Date.now();
  const clock = spyOn(Date, 'now').mockReturnValue(now);
  try {
    expect(await lookup.search(request, signal)).toHaveLength(1);
    expect(await lookup.search({ ...request, query: ' Test ' }, signal)).toHaveLength(1);
    expect(fetch_spy).toHaveBeenCalledTimes(1);
    const other_city = { ...nara, id: 'other-city', latitude: 15 };
    expect(await lookup.search({ ...request, location: other_city }, signal)).toEqual([]);
    expect(await lookup.search({ ...request, category: 'sight' }, signal)).toEqual([]);
    expect(await lookup.search({ ...request, query: '' }, signal)).toHaveLength(1);
    expect(fetch_spy).toHaveBeenCalledTimes(4);
    clock.mockReturnValue(now + 6 * 60_000);
    expect(await lookup.search(request, signal)).toHaveLength(1);
    expect(fetch_spy).toHaveBeenCalledTimes(5);
  } finally {
    fetch_spy.mockRestore();
    clock.mockRestore();
  }
});

test('late or unsuccessful place requests can be retried with fresh provider results', async () => {
  const lookup = createStopLookup(false, '');
  const request = { query: 'Test', city: 'Nara', category: 'stay', location: nara } as const;
  const controller = new AbortController();
  let finish!: (response: Response) => void;
  const deferred = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const fetch_spy = spyOn(globalThis, 'fetch')
    .mockReturnValueOnce(deferred)
    .mockResolvedValueOnce(new Response('', { status: 503 }))
    .mockResolvedValueOnce(Response.json({ features: [{ properties: hotel, geometry: point }] }));
  try {
    const late = lookup.search(request, controller.signal);
    expect(fetch_spy).toHaveBeenCalledTimes(1);
    controller.abort();
    finish(Response.json({ features: [] }));
    await expect(late).rejects.toThrow();
    const signal = new AbortController().signal;
    await expect(lookup.search(request, signal)).rejects.toThrow('unavailable');
    expect(await lookup.search(request, signal)).toHaveLength(1);
    expect(fetch_spy).toHaveBeenCalledTimes(3);
  } finally {
    fetch_spy.mockRestore();
  }
});
