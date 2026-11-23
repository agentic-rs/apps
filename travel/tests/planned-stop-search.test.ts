import { expect, test } from 'bun:test';
import kansai from '../fixtures/kansai.json';
import { parseJournal } from '../src/lib/model';
import {
  matchesPlannedPlace,
  plannedStopCityIndex,
  searchCityLabel,
  searchPlannedStops,
  suggestRouteAnchor,
} from '../src/lib/planned-stop-search';
import type { StopSearchResult } from '../src/lib/stop-lookup';
import type { PlannedStop } from '../src/lib/types';

const { stops } = parseJournal(kansai);
const park = stops.find((stop) => stop.title === 'Nara Park')!;
const nara = {
  id: 'geonames:1855612',
  country_code: 'JP',
  latitude: 34.68505,
  longitude: 135.80485,
};
const kyoto = {
  id: 'geonames:1857910',
  country_code: 'JP',
  latitude: 35.02107,
  longitude: 135.75385,
};
const cities = [
  { index: 0, name: 'Kyoto', location: kyoto },
  { index: 1, name: 'Nara', location: nara },
];

test('the name-only Kansai fixture yields its saved Day 2 Nara Park only in Nara', () => {
  const day = stops.filter((stop) => stop.day === park.day);
  expect(park.city).toBeUndefined();
  expect(park.directory_ref).toBeUndefined();
  expect(searchPlannedStops(day, 'park na', 'sight', cities, 1, park.day)).toEqual([park]);
  expect(searchPlannedStops(day, 'Nara Park', 'sight', cities, 0, park.day)).toEqual([]);
  expect(searchPlannedStops(day, 'Nara Park', 'stay', cities, 1, park.day)).toEqual([]);
  const other_pin: StopSearchResult = {
    id: 'W123',
    kind: 'sight',
    source: 'osm',
    title: 'Nara Park',
    subtitle: 'Nara, Japan',
    position: { latitude: park.position!.latitude + 0.01, longitude: park.position!.longitude },
  };
  expect(matchesPlannedPlace(park, other_pin)).toBe(false);
  expect(matchesPlannedPlace(park, { ...other_pin, position: park.position! })).toBe(true);
  expect(
    matchesPlannedPlace({ ...park, directory_ref: { provider: 'osm', id: 'W123' } }, other_pin),
  ).toBe(true);
  expect(
    matchesPlannedPlace(
      { ...park, directory_ref: { provider: 'osm', id: 'W124' } },
      { ...other_pin, position: park.position! },
    ),
  ).toBe(false);
});

test('links suggested, searched and saved places by their shared OSM object', () => {
  const saved: PlannedStop = {
    ...park,
    directory_ref: { provider: 'geoapify', id: 'autocomplete-id', osm_ref: 'W123' },
  };
  const place: StopSearchResult = {
    source: 'geoapify',
    id: 'places-id',
    osm_ref: 'W123',
    title: 'Alternate name',
    kind: 'sight',
    position: park.position!,
    subtitle: '',
  };
  expect(matchesPlannedPlace(saved, place)).toBe(true);
  expect(
    matchesPlannedPlace(saved, { ...place, source: 'osm', id: 'W123', osm_ref: undefined }),
  ).toBe(true);
  expect(matchesPlannedPlace(saved, { ...place, id: 'autocomplete-id', osm_ref: undefined })).toBe(
    true,
  );
  expect(matchesPlannedPlace(saved, { ...place, title: park.title, osm_ref: 'N123' })).toBe(false);
});

test('uses an explicitly assigned city for hotels and never guesses between close day cities', () => {
  const hotel = {
    ...park,
    title: 'Hôtel du Parc',
    kind: 'stay' as const,
    city: 'Kyoto',
    city_id: kyoto.id,
    position: null,
  };
  expect(searchPlannedStops([hotel], 'hotel parc', 'stay', cities, 0, park.day)).toEqual([hotel]);
  expect(searchPlannedStops([hotel], 'hotel parc', 'stay', cities, 1, park.day)).toEqual([]);
  const overlapping = [
    cities[1],
    { index: 2, name: 'Another town', location: { ...nara, longitude: nara.longitude + 0.015 } },
  ];
  expect(searchPlannedStops([park], 'park', 'all', overlapping, 1, park.day)).toEqual([]);
  expect(
    searchPlannedStops(
      [park],
      'park',
      'all',
      [cities[1], { index: 2, name: 'Unknown' }],
      1,
      park.day,
    ),
  ).toEqual([]);
  expect(searchPlannedStops([park], 'park', 'all', [cities[1]], 1, park.day)).toEqual([park]);
  expect(
    searchPlannedStops(
      [{ ...park, city: 'Unlisted town' }],
      'park',
      'all',
      [cities[1]],
      1,
      park.day,
    ),
  ).toEqual([]);
});

test('offline lodging filters use the saved place type within the selected city', () => {
  const hostel: PlannedStop = {
    ...park,
    id: 'hostel',
    kind: 'stay',
    city: 'Nara',
    title: 'Deer house',
    directory_ref: { provider: 'osm', id: 'N1', place_type: 'hostel' },
  };
  const hotel: PlannedStop = {
    ...hostel,
    id: 'hotel',
    title: 'Lantern house',
    directory_ref: { provider: 'osm', id: 'N2', place_type: 'hotel' },
  };
  const legacy: PlannedStop = {
    ...hostel,
    id: 'legacy',
    title: 'Hostel house',
    directory_ref: { provider: 'osm', id: 'N3' },
  };
  const kyoto_hostel = { ...hostel, id: 'other-city', city: 'Kyoto' };
  const stays = [hostel, hotel, legacy, kyoto_hostel];
  expect(searchPlannedStops(stays, '', 'stay', cities, 1, park.day, '', 'hostels')).toEqual([
    hostel,
  ]);
  expect(
    searchPlannedStops(stays, '  ', 'stay', [], undefined, park.day, 'Kyoto', 'hostels'),
  ).toEqual([kyoto_hostel]);
  expect(searchPlannedStops(stays, '', 'stay', cities, 1, park.day)).toEqual([]);
  expect(searchPlannedStops(stays, 'house', 'stay', cities, 1, park.day, '', 'hostels')).toEqual([
    hostel,
  ]);
  expect(searchPlannedStops(stays, 'house', 'stay', cities, 0, park.day, '', 'hostels')).toEqual([
    kyoto_hostel,
  ]);
  expect(searchPlannedStops(stays, 'house', 'stay', cities, 1, park.day, '', 'hotels')).toEqual([
    hotel,
  ]);
  expect(searchPlannedStops(stays, 'house', 'stay', cities, 1, park.day)).toEqual([
    hostel,
    hotel,
    legacy,
  ]);
  expect(
    matchesPlannedPlace(legacy, {
      id: 'N3',
      source: 'osm',
      kind: 'stay',
      place_type: 'hostel',
      title: 'Renamed inn',
      subtitle: 'Nara, Japan',
      position: park.position!,
    }),
  ).toBe(true);
});

test('an unscoped earlier hotel requires nearby coordinates to appear in a later single-city day', () => {
  const hotel = { ...park, title: 'Saved inn', kind: 'stay' as const, checkout_date: '2030-05-25' };
  const day = '2030-05-22';
  expect(searchPlannedStops([hotel], 'saved inn', 'stay', [cities[0]], 0, day)).toEqual([]);
  expect(searchPlannedStops([hotel], 'saved inn', 'stay', [cities[1]], 1, day)).toEqual([hotel]);
  expect(
    searchPlannedStops([{ ...hotel, position: null }], 'saved inn', 'stay', [cities[1]], 1, day),
  ).toEqual([]);
  const assigned = { ...hotel, city: 'Kyoto', position: null };
  expect(searchPlannedStops([assigned], 'saved', 'stay', [cities[0]], 0, day)).toEqual([assigned]);
});

test('a manually entered city finds only explicitly assigned stops when the trip has no city list', () => {
  const assigned = { ...park, city: 'Kyōto', position: null };
  expect(
    searchPlannedStops([assigned, park], 'park', 'sight', [], undefined, park.day, ' KYOTO '),
  ).toEqual([assigned]);
  expect(
    searchPlannedStops([assigned, park], 'park', 'sight', [], undefined, park.day, 'Nara'),
  ).toEqual([]);
});

test('a new Kyoto activity goes before the Kansai fixture’s Nara arrival station', () => {
  const route = stops.filter((stop) => stop.day === park.day);
  const [station] = route;
  const candidate = { kind: 'sight' as const, city: 'Kyoto' };
  expect(plannedStopCityIndex(station, cities, park.day)).toBe(1);
  expect(suggestRouteAnchor(cities, stops, candidate, park.day)).toBe(station.id);
  for (const kind of ['food', 'other'] as const) {
    const morning = { ...park, id: 'morning', city: 'Kyoto', position: null };
    expect(suggestRouteAnchor(cities, [morning, ...route], { ...candidate, kind }, park.day)).toBe(
      station.id,
    );
  }
  expect(
    suggestRouteAnchor(cities, route, { ...candidate, city: 'Nara' }, park.day),
  ).toBeUndefined();
  expect(
    suggestRouteAnchor(cities, [station, { ...park, city: 'Kyoto' }], candidate, park.day),
  ).toBeUndefined();
  expect(
    suggestRouteAnchor(
      cities.map(({ name, index }) => ({ name, index })),
      route,
      candidate,
      park.day,
    ),
  ).toBeUndefined();
});

test('leaves new hotels, transport, unscoped activities and non-transfer days at the end', () => {
  const route = [park];
  for (const kind of ['stay', 'transport'] as const) {
    expect(suggestRouteAnchor(cities, route, { kind, city: 'Kyoto' }, park.day)).toBeUndefined();
  }
  const candidate = { kind: 'sight' as const, city: 'Kyoto' };
  expect(suggestRouteAnchor(cities, route, { kind: 'sight' }, park.day)).toBeUndefined();
  expect(
    suggestRouteAnchor(cities, route, { ...candidate, city: 'Unlisted town' }, park.day),
  ).toBeUndefined();
  expect(suggestRouteAnchor([], route, candidate, park.day)).toBeUndefined();
  expect(suggestRouteAnchor([cities[0]], route, candidate, park.day)).toBeUndefined();
  const earlier_stay = {
    ...park,
    kind: 'stay' as const,
    day: '2030-05-20',
    checkout_date: '2030-05-23',
  };
  expect(suggestRouteAnchor(cities, [earlier_stay], candidate, park.day)).toBeUndefined();
});

test('unknown stops block automatic placement only when their city could move the boundary', () => {
  const candidate = { kind: 'food' as const, city: 'Kyoto' };
  const breakfast = { ...park, id: 'breakfast', city: 'Kyoto', position: null };
  const unknown = { ...park, id: 'transfer', kind: 'transport' as const, position: null };
  expect(
    suggestRouteAnchor(cities, [breakfast, unknown, park], candidate, park.day),
  ).toBeUndefined();
  expect(suggestRouteAnchor(cities, [unknown, park], candidate, park.day)).toBeUndefined();
  expect(
    suggestRouteAnchor(
      cities,
      [unknown, breakfast, park, { ...unknown, id: 'later' }],
      candidate,
      park.day,
    ),
  ).toBe(park.id);
});

test('a return visit cannot be inferred even when the stop ID identifies the city', () => {
  const loop = [...cities, { ...cities[0], index: 2 }];
  const breakfast = { ...park, city: 'Kyoto', city_id: kyoto.id };
  expect(plannedStopCityIndex(breakfast, loop, park.day)).toBeUndefined();
  for (const selected of [0, 2]) {
    expect(searchPlannedStops([breakfast], 'park', 'sight', loop, selected, park.day)).toEqual([
      breakfast,
    ]);
  }
  const candidate = { kind: 'sight' as const, city: 'Nara' };
  expect(suggestRouteAnchor(loop, [park, breakfast], candidate, park.day)).toBeUndefined();
  const osaka = { ...park, id: 'castle', city: 'Osaka', position: null };
  const osaka_visit = { index: 3, name: 'Osaka' };
  expect(suggestRouteAnchor([...cities, osaka_visit], [osaka], candidate, park.day)).toBe(osaka.id);
  expect(suggestRouteAnchor([...loop, osaka_visit], [osaka], candidate, park.day)).toBeUndefined();
  expect(
    suggestRouteAnchor(
      [...cities, { index: 2, name: 'Kyōto' }],
      [park],
      { ...candidate, city: 'Kyoto', city_id: kyoto.id },
      park.day,
    ),
  ).toBeUndefined();
});

test('distinct namesakes require an identifiable destination and honor a recorded city ID', () => {
  const namesakes = [
    { ...cities[0], index: 4, name: 'Central' },
    { ...cities[1], index: 5, name: 'Central' },
  ];
  const candidate = { kind: 'sight' as const, city: 'Central' };
  const stop = { ...park, city: 'Central', city_id: nara.id, position: null };
  expect(plannedStopCityIndex(stop, namesakes, park.day)).toBe(5);
  expect(suggestRouteAnchor(namesakes, [stop], candidate, park.day)).toBeUndefined();
  expect(suggestRouteAnchor(namesakes, [stop], { ...candidate, city_id: kyoto.id }, park.day)).toBe(
    stop.id,
  );
  expect(
    suggestRouteAnchor(namesakes, [stop], { ...candidate, city_id: 'geonames:1' }, park.day),
  ).toBeUndefined();
  expect(plannedStopCityIndex({ ...park, city: 'Nara', city_id: kyoto.id }, cities, park.day)).toBe(
    0,
  );
});

test('city labels distinguish namesakes and repeat visits by their full trip position', () => {
  const visits = [
    {
      index: 3,
      name: 'York',
      location: {
        id: 'geonames:2633352',
        country_code: 'GB',
        latitude: 53.95763,
        longitude: -1.08271,
      },
    },
    {
      index: 4,
      name: 'York',
      location: {
        id: 'geonames:4562407',
        country_code: 'US',
        latitude: 39.9626,
        longitude: -76.72774,
      },
    },
    { index: 5, name: 'York' },
    { index: 6, name: 'London' },
  ];
  expect(searchCityLabel(visits, 3)).toBe('York · GB · City 4');
  expect(searchCityLabel(visits, 4)).toBe('York · US · City 5');
  expect(searchCityLabel(visits, 5)).toBe('York · City 6');
  expect(searchCityLabel(visits, 6)).toBe('London');
});
