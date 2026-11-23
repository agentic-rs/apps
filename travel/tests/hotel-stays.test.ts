import { expect, test } from 'bun:test';
import {
  checkoutAfter,
  continuingStays,
  moveStayCheckIn,
  stayDayPage,
  staysForNight,
  staysInRange,
} from '../src/lib/hotel-stays';
import type { PlannedStop } from '../src/lib/types';

const hotel: PlannedStop = {
  id: 'h',
  trip_id: 't',
  title: 'Nara Hotel',
  kind: 'stay',
  day: '2028-02-28',
  checkout_date: '2028-03-01',
  time: '',
  notes: '',
  position: null,
};

test('links a hotel across subsequent nights and on the day of departure', () => {
  for (const date of ['2028-02-27', hotel.day, '2028-03-02'])
    expect(continuingStays([hotel], date)).toEqual([]);
  expect(continuingStays([hotel], '2028-02-29')).toEqual([
    { stop: hotel, label: 'Staying at Nara Hotel' },
  ]);
  expect(continuingStays([hotel], '2028-03-01')).toEqual([
    { stop: hotel, label: 'Check out of Nara Hotel' },
  ]);
});

test('shows overlapping stays, including a single night, and skips undated stays and unrelated stops', () => {
  const second = { ...hotel, id: 'b', title: 'Annex', checkout_date: '2028-02-29' };
  const stops = [
    hotel,
    { ...hotel, checkout_date: undefined },
    { ...hotel, kind: 'sight' as const },
    second,
  ];
  expect(continuingStays(stops, '2028-02-29').map(({ label }) => label)).toEqual([
    'Staying at Nara Hotel',
    'Check out of Annex',
  ]);
});

test('night occupancy includes arrivals and distinguishes a same-day hotel transfer', () => {
  const next = { ...hotel, id: 'osaka', day: '2028-03-01', checkout_date: '2028-03-03' };
  const open = { ...next, id: 'open', checkout_date: undefined };
  const sight = { ...next, id: 'sight', kind: 'sight' as const, checkout_date: undefined };
  const stops = [next, sight, hotel, open];
  expect(staysForNight(stops, hotel.day)).toEqual([hotel]);
  expect(staysForNight(stops, '2028-02-29')).toEqual([hotel]);
  expect(staysForNight(stops, '2028-03-01')).toEqual([next, open]);
  expect(staysForNight(stops, '2028-03-01', next.id)).toEqual([open]);
  expect(staysForNight(stops, '2028-03-02')).toEqual([next]);
  expect(staysForNight(stops, '2028-03-03')).toEqual([]);
  expect(staysForNight(stops, '2028-02-30')).toEqual([]);
});

test('date selection intersects occupied nights and keeps same-night ties in itinerary order', () => {
  const open = { ...hotel, id: 'open', day: '2028-03-01', checkout_date: undefined };
  const osaka = { ...hotel, id: 'osaka', day: '2028-03-01', checkout_date: '2028-03-05' };
  const later = { ...open, id: 'later', day: '2028-03-04' };
  const stops = [osaka, later, open, hotel];
  expect(staysInRange(stops, '2028-02-29', '2028-03-04')).toEqual([
    { stop: hotel, first_night: '2028-02-29', last_night: '2028-02-29' },
    { stop: osaka, first_night: '2028-03-01', last_night: '2028-03-03' },
    { stop: open, first_night: '2028-03-01', last_night: '2028-03-01' },
  ]);
  expect(staysInRange(stops, '2028-03-01', '', osaka.id)).toEqual([
    { stop: open, first_night: '2028-03-01', last_night: '2028-03-01' },
  ]);
  expect(staysInRange([hotel], '2028-03-01', '2028-03-03')).toEqual([]);
  expect(staysInRange([hotel], '2028-02-27', '2028-02-28')).toEqual([]);
});

test('incomplete ranges do not invent lodging and valid ranges can span the calendar', () => {
  for (const [start, end] of [
    ['', '2028-03-01'],
    [hotel.day, '2028-02-30'],
    [hotel.day, hotel.day],
    ['2028-03-01', hotel.day],
  ])
    expect(staysInRange([hotel], start, end)).toEqual([]);
  const long = { ...hotel, day: '0000-01-01', checkout_date: '9999-12-31' };
  expect(staysInRange([long], long.day, long.checkout_date)).toEqual([
    { stop: long, first_night: long.day, last_night: '9999-12-30' },
  ]);
  const open = { ...hotel, day: '9999-12-31', checkout_date: undefined };
  expect(staysInRange([long, open], open.day, '')).toEqual([
    { stop: open, first_night: open.day, last_night: open.day },
  ]);
});

test('rescheduling preserves occupied nights across leap days and keeps an open departure open', () => {
  expect(moveStayCheckIn('2028-02-28', '2028-03-02', '2028-12-30')).toBe('2029-01-02');
  expect(moveStayCheckIn('2028-02-28', '', '2028-12-30')).toBe('');
  expect(checkoutAfter('2028-02-28', 1)).toBe('2028-02-29');
  expect(checkoutAfter('2028-02-28', 0)).toBe('');
  expect(checkoutAfter('2027-02-29', 1)).toBe('');
});

test('only representable nights are offered at the end of the calendar', () => {
  expect(moveStayCheckIn('2028-02-28', '2028-03-02', '9999-12-30')).toBe('9999-12-31');
  expect(checkoutAfter('9999-12-31', 1)).toBe('');
});

test('day pages span month boundaries, join without gaps, and include the final checkout day', () => {
  const first = '2028-02-24';
  const last = '2028-03-07';
  const one = stayDayPage(first, last, first);
  expect(one.dates).toHaveLength(7);
  expect(one.dates.at(-1)).toBe('2028-03-01');
  expect(one.previous).toBeUndefined();
  expect(one.next).toBe('2028-03-02');
  const two = stayDayPage(first, last, one.next!);
  expect(two.previous).toBe(first);
  expect(two.dates[0]).toBe('2028-03-02');
  expect(two.dates.at(-1)).toBe(last);
  expect(two.next).toBeUndefined();
  const extreme = stayDayPage('0000-01-01', '9999-12-31', '9999-12-31');
  expect(extreme.dates.length).toBeLessThanOrEqual(7);
  expect(extreme.dates.at(-1)).toBe('9999-12-31');
  expect(extreme.next).toBeUndefined();
});
