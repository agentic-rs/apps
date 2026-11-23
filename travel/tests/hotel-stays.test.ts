import { expect, test } from 'bun:test';
import {
  checkoutAfter,
  continuingStays,
  moveStayCheckIn,
  stayDayPage,
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
