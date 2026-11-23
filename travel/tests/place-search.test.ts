import { expect, spyOn, test } from 'bun:test';
import { placeSearchUrl, readPlaceResults } from '../src/lib/place-providers';
import {
  isPlaceType,
  matchesPlaceType,
  placeTypeFilters,
  placeTypeLabel,
} from '../src/lib/place-types';
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
      place_type: 'hotel',
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

test.each(['Photon', 'Geoapify'])(
  '%s searches within three kilometers of a planned place for nearby and named results',
  async (provider) => {
    const geoapify = provider === 'Geoapify';
    const lookup = createStopLookup(false, geoapify ? 'test' : '');
    const origin = { latitude: 35, longitude: 135.7, id: 'private-stop', title: 'Private notes' };
    // Simulate a rectangular or imperfect provider filter on either side of the circle.
    const features = [2.999, 3.001].map((km, i) => ({
      geometry: {
        type: 'Point',
        coordinates: [origin.longitude, origin.latitude + (km / 6371) * (180 / Math.PI)],
      },
      properties: geoapify
        ? {
            name: 'Inn',
            place_id: 'fixture-' + i,
            categories: ['accommodation.hotel'],
            category: 'accommodation.hotel',
            result_type: 'amenity',
          }
        : { ...hotel, osm_id: 20 + i },
    }));
    const fetch_spy = spyOn(globalThis, 'fetch');
    try {
      for (const { query, suggest } of [
        { query: '' },
        { query: 'Inn' },
        { query: 'In', suggest: true },
      ]) {
        fetch_spy.mockResolvedValueOnce(Response.json({ features }));
        const places = await lookup.search(
          {
            category: 'stay',
            type_filter: 'hotels',
            city: 'My custom city',
            origin,
            query,
            suggest,
          },
          new AbortController().signal,
        );
        expect(places).toHaveLength(1);
        expect(places[0].distance_km).toBeCloseTo(2.999, 6);
        const url = new URL(String(fetch_spy.mock.calls.at(-1)![0]));
        const sent = [...url.searchParams.values()].join(' ');
        for (const private_value of ['My custom city', origin.id, origin.title]) {
          expect(sent).not.toContain(private_value);
        }
        if (geoapify) {
          expect(url.searchParams.get('filter')).toBe('circle:135.7,35,3000');
          expect(url.searchParams.get('bias')).toBe('proximity:135.7,35');
          expect(url.pathname).toBe(suggest ? '/v1/geocode/autocomplete' : '/v2/places');
          if (query) expect(url.searchParams.get(suggest ? 'text' : 'name')).toBe(query);
          else expect(url.searchParams.get('conditions')).toBe('named');
        } else {
          expect(url.searchParams.get('lat')).toBe('35');
          expect(url.searchParams.get('lon')).toBe('135.7');
          expect(url.searchParams.getAll('osm_tag')).toEqual(['tourism:hotel']);
          if (query) {
            expect(url.searchParams.get('q')).toBe(query);
            const [west, south, east, north] = url.searchParams.get('bbox')!.split(',').map(Number);
            expect(south).toBeCloseTo(34.973, 3);
            expect(north).toBeCloseTo(35.027, 3);
            expect(west).toBeCloseTo(135.667, 3);
            expect(east).toBeCloseTo(135.733, 3);
          } else expect(url.searchParams.get('radius')).toBe('3');
        }
      }
    } finally {
      fetch_spy.mockRestore();
    }
  },
);

test('isolates a planned-place radius from another origin and from city-wide results at the same point', async () => {
  const lookup = createStopLookup(false, '');
  const signal = new AbortController().signal;
  const request = { category: 'sight' as const, city: 'Nara', location: nara, query: '' };
  const payload = {
    features: [{ properties: { ...hotel, osm_value: 'museum' }, geometry: point }],
  };
  const fetch_spy = spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json(payload))
    .mockResolvedValueOnce(Response.json(payload))
    .mockResolvedValueOnce(Response.json(payload));
  try {
    const with_origin = {
      ...request,
      origin: { latitude: nara.latitude, longitude: nara.longitude },
    };
    const city = await lookup.search(request, signal);
    const anchored = await lookup.search(with_origin, signal);
    expect(anchored).toHaveLength(1);
    expect(anchored).not.toBe(city);
    expect(
      await lookup.search({ ...request, origin: { latitude: 35, longitude: 135.7 } }, signal),
    ).toBeEmpty();
    expect(await lookup.search(with_origin, signal)).toBe(anchored);
    expect(await lookup.search(request, signal)).toBe(city);
    expect(fetch_spy).toHaveBeenCalledTimes(3);
  } finally {
    fetch_spy.mockRestore();
  }
});

test('only sight and hotel lookups send a valid explicitly requested origin', async () => {
  const lookup = createStopLookup(false, '');
  const origin = { latitude: 35, longitude: 135.7 };
  const signal = new AbortController().signal;
  const request = { query: 'Test', city: 'Nara', location: nara, origin };
  const fetch_spy = spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ features: [] }))
    .mockResolvedValueOnce(Response.json({ features: [] }));
  try {
    for (const category of ['food', 'all'] as const) {
      await lookup.search({ ...request, category }, signal);
      const url = new URL(String(fetch_spy.mock.calls.at(-1)![0]));
      expect(url.searchParams.get('lat')).toBe(String(nara.latitude));
      expect(url.searchParams.get('lon')).toBe(String(nara.longitude));
    }
    await expect(
      lookup.search(
        { ...request, category: 'stay', origin: { latitude: NaN, longitude: 0 } },
        signal,
      ),
    ).rejects.toThrow('Latitude');
    await expect(
      lookup.search({ ...request, category: 'sight' }, AbortSignal.abort()),
    ).rejects.toThrow();
    expect(fetch_spy).toHaveBeenCalledTimes(2);
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

test('type choices narrow named and nearby requests for each provider', () => {
  const examples = [
    [
      'museums',
      'sight',
      ['tourism:museum', 'tourism:gallery'],
      ['entertainment.museum', 'entertainment.culture.gallery'],
    ],
    ['parks', 'sight', ['leisure:garden', 'leisure:park'], ['leisure.park']],
    [
      'worship',
      'sight',
      ['amenity:place_of_worship'],
      ['religion.place_of_worship', 'tourism.sights.place_of_worship'],
    ],
    ['hotels', 'stay', ['tourism:hotel'], ['accommodation.hotel']],
    ['hostels', 'stay', ['tourism:hostel'], ['accommodation.hostel']],
    ['guest_houses', 'stay', ['tourism:guest_house'], ['accommodation.guest_house']],
  ] as const;
  for (const [filter, category, tags, categories] of examples) {
    expect(placeTypeFilters(category).map(({ id }) => id)).toContain(filter);
    for (const query of ['', '奈良']) {
      const photon = placeSearchUrl(query, category, 'Nara', nara, '', filter);
      expect(photon.searchParams.getAll('osm_tag')).toEqual([...tags]);
      const geo = placeSearchUrl(query, category, 'Nara', nara, 'test', filter);
      expect(geo.searchParams.get('categories')?.split(',')).toEqual([...categories]);
      expect(geo.searchParams.get('conditions')).toBe(query ? null : 'named');
      expect(geo.searchParams.get('name')).toBe(query || null);
    }
  }
  expect(placeTypeFilters('food')).toEqual([]);
  expect(() => placeSearchUrl('', 'stay', 'Nara', nara, '', 'museums')).toThrow('category');
});

test('place types come from provider classifications and remain usable with local place names', () => {
  const rows = [
    {
      city: 'Nara',
      name: '華楽園',
      osm_key: 'leisure',
      osm_value: 'garden',
      categories: ['leisure.park', 'leisure.park.garden', 'tourism.attraction'],
    },
    {
      city: 'Nara',
      name: 'Heritage Garden',
      osm_key: 'leisure',
      osm_value: 'park',
      categories: ['leisure.park'],
    },
    {
      city: 'Kyoto',
      name: 'Museum Inn',
      osm_key: 'tourism',
      osm_value: 'guest_house',
      categories: ['accommodation.guest_house'],
    },
    {
      city: 'Kyoto',
      name: 'Museum Hotel',
      osm_key: 'tourism',
      osm_value: 'hotel',
      categories: ['accommodation.hotel'],
    },
    {
      city: 'Nara',
      name: 'Temples Museum',
      osm_key: 'tourism',
      osm_value: 'museum',
      categories: ['tourism.attraction', 'entertainment.museum'],
    },
  ];
  const payload = {
    features: rows.map((properties, i) => ({
      properties: { ...properties, osm_type: 'N', osm_id: i + 1, place_id: String(i + 1) },
      geometry: point,
    })),
  };
  for (const geoapify of [false, true]) {
    const all = readPlaceResults(payload, geoapify, 'all');
    expect(all.map((place) => place.place_type)).toEqual([
      'garden',
      'park',
      'guest_house',
      'hotel',
      'museum',
    ]);
    expect(filterNearbyPlaces(all, 'garden nara').map((place) => place.title)).toEqual([
      '華楽園',
      'Heritage Garden',
    ]);
    expect(
      readPlaceResults(payload, geoapify, 'sight', 'parks').map((place) => place.title),
    ).toEqual(['華楽園', 'Heritage Garden']);
    expect(readPlaceResults(payload, geoapify, 'sight', 'worship')).toBeEmpty();
    expect(
      readPlaceResults(payload, geoapify, 'stay', 'guest_houses').map((place) => place.title),
    ).toEqual(['Museum Inn']);
  }
  expect(matchesPlaceType(undefined, 'parks')).toBe(false);
  expect(matchesPlaceType('guest_house', 'hotels')).toBe(false);
  expect(isPlaceType('garden')).toBe(true);
  expect(isPlaceType('toString')).toBe(false);
  expect(placeTypeLabel('guest_house')).toBe('Guest house');
});

test('Geoapify filters use the matching activity when a venue serves several purposes', () => {
  const museum_cafe = {
    geometry: point,
    properties: {
      place_id: 'museum-cafe',
      name: 'Museum and café',
      categories: ['catering.cafe', 'entertainment.museum'],
    },
  };
  const payload = { features: [museum_cafe] };
  expect(readPlaceResults(payload, true, 'sight', 'museums')[0]).toMatchObject({
    kind: 'sight',
    place_type: 'museum',
  });
  expect(readPlaceResults(payload, true, 'stay', 'guest_houses')).toBeEmpty();
  expect(readPlaceResults(payload, true, 'all')[0].kind).toBe('food');
  expect(readPlaceResults(payload, true, 'sight')[0].place_type).toBe('museum');
});

test('Geoapify suggests named amenities in the chosen city and type, with provider and OSM identity', async () => {
  const lookup = createStopLookup(false, 'test');
  const signal = new AbortController().signal;
  const request = {
    category: 'stay',
    type_filter: 'hotels',
    query: 'Nar',
    city: 'Nara',
    location: nara,
  } as const;
  const raw = { osm_type: 'w', osm_id: '1234' };
  const base = {
    name: 'Nara Hotel',
    place_id: 'autocomplete-id',
    category: 'accommodation.hotel',
    city: 'Nara',
    country_code: 'jp',
    result_type: 'amenity',
    datasource: { sourcename: 'openstreetmap', raw },
  };
  const features = [
    base,
    base,
    { ...base, place_id: 'park', category: 'leisure.park' },
    { ...base, place_id: 'hostel', category: 'accommodation.hostel' },
    { ...base, place_id: 'street', result_type: 'street' },
    { ...base, place_id: '', name: 'No provider identity' },
  ].map((properties) => ({ properties, geometry: point }));
  features.push({
    properties: { ...base, place_id: 'too-far' },
    geometry: { type: 'Point', coordinates: [135, 35.5] },
  });
  const fetch_spy = spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ features }))
    .mockResolvedValueOnce(
      Response.json({
        features: [
          {
            geometry: point,
            properties: { ...base, place_id: 'places-id', categories: ['accommodation.hotel'] },
          },
        ],
      }),
    );
  try {
    const suggestions = await lookup.search({ ...request, suggest: true }, signal);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      source: 'geoapify',
      id: 'autocomplete-id',
      osm_ref: 'W1234',
      kind: 'stay',
      place_type: 'hotel',
      locality: 'Nara',
    });
    const url = new URL(String(fetch_spy.mock.calls[0][0]));
    expect(url.pathname).toBe('/v1/geocode/autocomplete');
    expect(url.searchParams.get('text')).toBe('Nar');
    expect(url.searchParams.get('type')).toBe('amenity');
    expect(url.searchParams.get('filter')).toBe('circle:135.833,34.685,40000');
    expect(url.searchParams.get('bias')).toBe('proximity:135.833,34.685');
    expect(url.searchParams.has('categories')).toBe(false);
    const explicit = await lookup.search(request, signal);
    expect(explicit[0]).toMatchObject({ id: 'places-id', osm_ref: 'W1234' });
    expect(new URL(String(fetch_spy.mock.calls[1][0])).pathname).toBe('/v2/places');
    expect(await lookup.search({ ...request, suggest: true }, signal)).toBe(suggestions);
    expect(await lookup.search(request, signal)).toBe(explicit);
    expect(fetch_spy).toHaveBeenCalledTimes(2);
  } finally {
    fetch_spy.mockRestore();
  }
});

test('unresolved Geoapify suggestions stay empty while manual submission explains the missing center', async () => {
  const lookup = createStopLookup(false, 'test');
  const signal = new AbortController().signal;
  const request = { category: 'sight', query: 'temple', city: '' } as const;
  const fetch_spy = spyOn(globalThis, 'fetch');
  try {
    expect(await lookup.search({ ...request, suggest: true }, signal)).toBeEmpty();
    await expect(lookup.search(request, signal)).rejects.toThrow('directory');
    expect(fetch_spy).not.toHaveBeenCalled();
  } finally {
    fetch_spy.mockRestore();
  }
});

test('Photon suggestions reuse the submitted query and scoped type even for partial names', async () => {
  const lookup = createStopLookup(false, '');
  const request = {
    city: 'Nara',
    location: nara,
    category: 'stay',
    type_filter: 'hotels',
    query: 'Nar',
  } as const;
  const signal = new AbortController().signal;
  const fetch_spy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    Response.json({ features: [{ geometry: point, properties: hotel }] }),
  );
  try {
    const suggestions = await lookup.search({ ...request, suggest: true }, signal);
    const url = new URL(String(fetch_spy.mock.calls[0][0]));
    expect(url.pathname).toBe('/api/');
    expect(url.searchParams.get('q')).toBe('Nar');
    expect(url.searchParams.getAll('osm_tag')).toEqual(['tourism:hotel']);
    expect(await lookup.search(request, signal)).toBe(suggestions);
    expect(fetch_spy).toHaveBeenCalledTimes(1);
  } finally {
    fetch_spy.mockRestore();
  }
});

test('a type search has its own cache entry, including when its response is empty', async () => {
  const lookup = createStopLookup(false, '');
  const signal = new AbortController().signal;
  const request = { category: 'stay', query: '', city: 'Nara', location: nara } as const;
  const payload = { features: [{ properties: hotel, geometry: point }] };
  const fetch_spy = spyOn(globalThis, 'fetch');
  for (let i = 0; i < 3; i++) fetch_spy.mockResolvedValueOnce(Response.json(payload));
  try {
    expect(await lookup.search(request, signal)).toHaveLength(1);
    expect(await lookup.search({ ...request, type_filter: 'guest_houses' }, signal)).toBeEmpty();
    expect(await lookup.search({ ...request, type_filter: 'hotels' }, signal)).toHaveLength(1);
    expect(await lookup.search({ ...request, type_filter: 'guest_houses' }, signal)).toBeEmpty();
    expect(await lookup.search(request, signal)).toHaveLength(1);
    expect(fetch_spy).toHaveBeenCalledTimes(3);
  } finally {
    fetch_spy.mockRestore();
  }
});
