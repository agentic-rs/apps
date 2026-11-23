import { expect, test } from 'bun:test';
import kansai from '../fixtures/kansai.json';
import singapore from '../fixtures/singapore.json';
import { plannedCheckInContext } from '../src/lib/check-in-place';
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
  expect(plannedCheckInContext(singapore_plan.trips[0], stop).place).toEqual({
    name: stop.title,
    locality: 'Singapore',
    position: stop.position,
  });
  expect(plannedCheckInContext(trip, stops[0]).place.locality).toBe('Kyoto');
});

test('the chosen stop city follows the place even outside a dated city leg', () => {
  const stop = { ...nara_park, city: 'Uji', day: '2030-05-25' };
  expect(plannedCheckInContext(trip, stop).place).toEqual({
    name: 'Nara Park',
    locality: 'Uji',
    position: nara_park.position,
  });
});

test('a transfer-day pin can identify a unique scheduled city with a saved center', () => {
  const kyoto = { id: 'geonames:1857910', country_code: 'JP', latitude: 35.02, longitude: 135.75 };
  const nara = { id: 'geonames:1855612', country_code: 'JP', latitude: 34.68, longitude: 135.81 };
  const route: Trip = { ...trip, city_locations: [kyoto, nara, null] };
  expect(plannedCheckInContext(route, nara_park)).toEqual({
    place: { name: nara_park.title, locality: 'Nara', position: nara_park.position },
    city_id: nara.id,
  });
  const resolved = [
    { index: 0, name: 'Kyoto', location: kyoto },
    { index: 1, name: 'Nara', location: nara },
  ];
  const legacy = plannedCheckInContext(trip, nara_park, resolved);
  expect(legacy.place.locality).toBe('Nara');
  expect(legacy.city_id).toBeUndefined();
  expect(
    plannedCheckInContext(trip, nara_park, [{ ...resolved[0], location: null }, resolved[1]]).place
      .locality,
  ).toBe('');
  expect(plannedCheckInContext(route, { ...nara_park, position: kyoto }).place.locality).toBe(
    'Kyoto',
  );
  expect(plannedCheckInContext(route, { ...nara_park, position: null }).place.locality).toBe('');
  expect(
    plannedCheckInContext(route, { ...nara_park, position: { latitude: 0, longitude: 0 } }).place
      .locality,
  ).toBe('');
});

test('unplanned, ambiguous or unscheduled stops receive no invented locality', () => {
  expect(plannedCheckInContext(trip)).toEqual({
    place: { name: '', locality: '', position: null },
  });
  expect(plannedCheckInContext(trip, nara_park).place.locality).toBe('');
  expect(plannedCheckInContext(trip, { ...nara_park, day: '2030-05-25' }).place.locality).toBe('');
  expect(plannedCheckInContext({ ...trip, cities: undefined }, nara_park).place.locality).toBe('');
});

test('a selected stop city stays authoritative when the itinerary later changes', () => {
  const stop = { ...nara_park, city: 'Uji', city_id: 'geonames:1849372', day: '2030-05-28' };
  const context = plannedCheckInContext(trip, stop);
  expect(context.city_id).toBe(stop.city_id);
  expect(context.place.locality).toBe('Uji');
});
