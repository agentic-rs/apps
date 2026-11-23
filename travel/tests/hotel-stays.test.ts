import { expect, test } from 'bun:test';
import { continuingStays } from '../src/lib/hotel-stays';
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
