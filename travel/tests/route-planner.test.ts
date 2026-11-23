import { describe, expect, test } from 'bun:test';
import { emptyJournal } from '../src/lib/model';
import {
  applyDayRoute,
  legDistanceKm,
  routeDistanceKm,
  suggestDayRoute,
} from '../src/lib/route-planner';
import type { CheckIn, PlannedStop } from '../src/lib/types';

const day = '2026-04-10';
const trip_id = 'trip-1';
function stop(id: string, longitude: number | null): PlannedStop {
  return {
    id,
    trip_id,
    day,
    title: id,
    kind: 'sight',
    time: '',
    notes: '',
    position: longitude === null ? null : { latitude: 0, longitude },
  };
}
const ids = (stops: readonly PlannedStop[]) => stops.map((stop) => stop.id);

describe('daily route suggestions', () => {
  test('great-circle distances take the short leg across the date line', () => {
    const east = { latitude: 0, longitude: 179.5 };
    const west = { latitude: 0, longitude: -179.5 };
    expect(legDistanceKm(east, west)).toBeCloseTo(111.195, 2);
    expect(legDistanceKm(east, west)).toBe(legDistanceKm(west, east));
    expect(legDistanceKm({ latitude: 50, longitude: 180 }, { latitude: 50, longitude: -180 })).toBe(
      0,
    );
    expect(
      legDistanceKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 180 }),
    ).toBeCloseTo(20015.087, 2);
    expect(routeDistanceKm([stop('a', 179.5), stop('b', -179.5), stop('c', -178.5)])).toBeCloseTo(
      222.39,
      2,
    );
  });

  test('distance is zero for a located day with no legs and unknown for incomplete positions', () => {
    expect(routeDistanceKm([])).toBe(0);
    expect(routeDistanceKm([stop('a', 8)])).toBe(0);
    expect(routeDistanceKm([stop('a', null)])).toBeNull();
    expect(routeDistanceKm([stop('a', 0), stop('b', null), stop('c', 2)])).toBeNull();
  });

  test('removes a detour without mutating the reviewed day; repeat previews are deterministic', () => {
    const stops = [stop('a', 179.8), stop('c', -179.8), stop('b', 179.9), stop('d', -179.7)];
    const reviewed = suggestDayRoute(stops, 'a', 'd');
    expect(ids(reviewed)).toEqual(['a', 'b', 'c', 'd']);
    expect(routeDistanceKm(reviewed)!).toBeLessThan(routeDistanceKm(stops)!);
    expect(ids(stops)).toEqual(['a', 'c', 'b', 'd']);
    expect(suggestDayRoute(stops, 'a', 'd')).toEqual(reviewed);
    expect(suggestDayRoute(reviewed, 'a', 'd')).toEqual(reviewed);
  });

  test('honors explicitly chosen endpoints, including a two-stop reversal; equal legs keep order', () => {
    const stops = [stop('a', 0), stop('b', 1), stop('c', 2), stop('d', 3)];
    expect(ids(suggestDayRoute(stops, 'd', 'a'))).toEqual(['d', 'c', 'b', 'a']);
    expect(ids(suggestDayRoute(stops.slice(0, 2), 'b', 'a'))).toEqual(['b', 'a']);
    const tied = [stop('a', 1), stop('c', 1), stop('b', 1), stop('d', 1)];
    expect(ids(suggestDayRoute(tied, 'a', 'd'))).toEqual(ids(tied));
  });

  test('rejects missing positions, unknown endpoints, duplicates, or mixed days and trips', () => {
    const stops = [stop('a', 1), stop('b', 2)];
    for (const invalid of [
      [stop('a', null), stops[1]],
      [stops[0], stop('other', null), stops[1]],
      [...stops, stops[0]],
      [stops[0], { ...stops[1], day: '2026-04-11' }],
      [stops[0], { ...stops[1], trip_id: 'trip-2' }],
    ])
      expect(() => suggestDayRoute(invalid, 'a', 'b')).toThrow();
    expect(() => suggestDayRoute(stops, 'a', 'a')).toThrow();
    expect(() => suggestDayRoute(stops, 'absent', 'b')).toThrow();
    expect(() => suggestDayRoute([], 'a', 'b')).toThrow();
  });

  test('keeps every distinct stop on a long day with fixed endpoints', () => {
    const stops = Array.from({ length: 4096 }, (_, i) => stop(String(i), ((i * 37) % 360) - 180));
    const suggested = suggestDayRoute(stops, stops[0].id, stops.at(-1)!.id);
    expect(suggested[0]).toBe(stops[0]);
    expect(suggested.at(-1)).toBe(stops.at(-1));
    expect(new Set(suggested)).toEqual(new Set(stops));
    expect(routeDistanceKm(suggested)!).toBeLessThanOrEqual(routeDistanceKm(stops)!);
  });
});

describe('applying a reviewed order', () => {
  const first = stop('first', 1);
  const other_day = { ...stop('next', 2), day: '2026-04-11' };
  const middle = { ...stop('middle', 4), time: '10:30', notes: 'Meet at the entrance.' };
  const other_trip = { ...stop('outside', 3), trip_id: 'trip-2' };
  const last = stop('last', 2);
  const original = [first.id, middle.id, last.id];
  const visit: CheckIn = {
    id: 'visit',
    trip_id,
    stop_id: middle.id,
    place_id: null,
    title: 'Lakeside',
    visited_at: day + 'T10:30:00.000Z',
    utc_offset_minutes: 0,
    actual_location: null,
    notes: '',
    photos: [],
    created_at: day + 'T10:30:00.000Z',
    updated_at: day + 'T10:30:00.000Z',
  };
  const journal = {
    ...emptyJournal(),
    stops: [first, other_day, middle, other_trip, last],
    check_ins: [visit],
  };

  test('replaces only the selected day’s slots and preserves all stop fields and check-in links', () => {
    const changed = applyDayRoute(journal, trip_id, day, original, ['last', 'first', 'middle']);
    expect(changed.stops).toEqual([last, other_day, first, other_trip, middle]);
    expect(changed.stops[4]).toBe(middle);
    expect(changed.check_ins).toBe(journal.check_ins);
    expect(changed.places).toBe(journal.places);
    expect(journal.stops).toEqual([first, other_day, middle, other_trip, last]);
    expect(applyDayRoute(journal, trip_id, day, original, original)).toBe(journal);
  });

  test('manual order can move a stop without a pin and preserves its latest data and check-ins', () => {
    const unlocated = { ...middle, notes: 'New meeting time.', position: null };
    const latest = { ...journal, stops: [first, other_day, unlocated, other_trip, last] };
    const changed = applyDayRoute(
      latest,
      trip_id,
      day,
      original,
      ['middle', 'last', 'first'],
      'manual',
    );
    expect(changed.stops).toEqual([unlocated, other_day, last, other_trip, first]);
    expect(changed.stops[0]).toBe(unlocated);
    expect(changed.check_ins).toBe(journal.check_ins);
    expect(applyDayRoute(latest, trip_id, day, original, original, 'manual')).toBe(latest);
    expect(() => applyDayRoute(latest, trip_id, day, original, original)).toThrow('coordinates');
  });

  test('both order modes reject a changed set or order after preview', () => {
    const snapshots = [
      { ...journal, stops: [...journal.stops, stop('new', 3)] },
      { ...journal, stops: journal.stops.slice(0, -1) },
      { ...journal, stops: [last, middle, first] },
    ];
    for (const mode of ['manual', 'optimized'] as const) {
      for (const snapshot of snapshots) {
        expect(() => applyDayRoute(snapshot, trip_id, day, original, original, mode)).toThrow(
          'changed',
        );
      }
    }
  });

  test('requires exactly one occurrence of every stop from the selected trip and day', () => {
    const invalid_orders = [
      ['first', 'middle'],
      ['first', 'middle', 'middle'],
      ['first', 'middle', 'next'],
      ['first', 'middle', 'outside'],
      ['first', 'middle', 'last', 'absent'],
    ];
    for (const mode of ['manual', 'optimized'] as const) {
      for (const order of invalid_orders) {
        expect(() => applyDayRoute(journal, trip_id, day, original, order, mode)).toThrow();
      }
      expect(() => applyDayRoute(journal, 'absent', day, [], [], mode)).toThrow();
    }
  });
});
