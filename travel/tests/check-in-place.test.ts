import { expect, test } from 'bun:test';
import kansai from '../fixtures/kansai.json';
import singapore from '../fixtures/singapore.json';
import { plannedCheckInPlace } from '../src/lib/check-in-place';
import { parseJournal } from '../src/lib/model';
import type { Trip } from '../src/lib/types';

const singapore_plan = parseJournal(singapore);
const {
  trips: [trip],
  stops,
} = parseJournal(kansai);
const nara_park = stops.find((stop) => stop.title === 'Nara Park')!;

test('older single-city stops inherit the city and keep the place pin', () => {
  const stop = singapore_plan.stops.find((item) => item.title === 'Ngee Ann City')!;
  expect(plannedCheckInPlace(singapore_plan.trips[0], stop)).toEqual({
    name: stop.title,
    locality: 'Singapore',
    position: stop.position,
  });
  expect(plannedCheckInPlace(trip, stops[0]).locality).toBe('Kyoto');
});

test('the chosen stop city follows the place even outside a dated city leg', () => {
  const stop = { ...nara_park, city: 'Uji', day: '2030-05-25' };
  expect(plannedCheckInPlace(trip, stop)).toEqual({
    name: 'Nara Park',
    locality: 'Uji',
    position: nara_park.position,
  });
});

test('a transfer-day pin can identify a unique scheduled city with a saved center', () => {
  const kyoto = { id: 'geonames:1857910', country_code: 'JP', latitude: 35.02, longitude: 135.75 };
  const nara = { id: 'geonames:1855612', country_code: 'JP', latitude: 34.68, longitude: 135.81 };
  const route: Trip = { ...trip, city_locations: [kyoto, nara, null] };
  expect(plannedCheckInPlace(route, nara_park).locality).toBe('Nara');
  const resolved = [
    { index: 0, name: 'Kyoto', location: kyoto },
    { index: 1, name: 'Nara', location: nara },
  ];
  expect(plannedCheckInPlace(trip, nara_park, resolved).locality).toBe('Nara');
  expect(
    plannedCheckInPlace(trip, nara_park, [{ ...resolved[0], location: null }, resolved[1]])
      .locality,
  ).toBe('');
  expect(plannedCheckInPlace(route, { ...nara_park, position: kyoto }).locality).toBe('Kyoto');
  expect(plannedCheckInPlace(route, { ...nara_park, position: null }).locality).toBe('');
  expect(
    plannedCheckInPlace(route, { ...nara_park, position: { latitude: 0, longitude: 0 } }).locality,
  ).toBe('');
});

test('unplanned, ambiguous or unscheduled stops receive no invented locality', () => {
  expect(plannedCheckInPlace(trip)).toEqual({ name: '', locality: '', position: null });
  expect(plannedCheckInPlace(trip, nara_park).locality).toBe('');
  expect(plannedCheckInPlace(trip, { ...nara_park, day: '2030-05-25' }).locality).toBe('');
  expect(plannedCheckInPlace({ ...trip, cities: undefined }, nara_park).locality).toBe('');
});
