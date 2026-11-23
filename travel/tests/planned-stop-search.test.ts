import { expect, test } from 'bun:test';
import kansai from '../fixtures/kansai.json';
import { parseJournal } from '../src/lib/model';
import { matchesPlannedPlace, searchPlannedStops } from '../src/lib/planned-stop-search';
import type { StopSearchResult } from '../src/lib/stop-lookup';

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
