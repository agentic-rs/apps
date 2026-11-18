import { describe, expect, test } from 'bun:test';
import { fitCoordinates, mapPoints } from '../src/lib/map';
import type { CheckIn, Coordinates, Place } from '../src/lib/types';

const now = '2026-05-12T14:20:00.000Z';

function place(id: string, position: Coordinates | null): Place {
  return { id, name: `Place ${id}`, locality: '', position, created_at: now, updated_at: now };
}

function visit(id: string, place_id: string, position: Coordinates | null): CheckIn {
  return {
    id,
    trip_id: 'trip-1',
    place_id,
    visited_at: now,
    utc_offset_minutes: 0,
    actual_location: position
      ? { ...position, accuracy_m: null, source: 'manual', captured_at: null }
      : null,
    notes: '',
    photos: [],
    created_at: now,
    updated_at: now,
  };
}

describe('map locations', () => {
  test('visit and named-place modes use only their own coordinates', () => {
    const places = [place('a', { latitude: 12, longitude: 34 })];
    const visits = [visit('one', 'a', { latitude: 12.1, longitude: 34.2 })];
    const actual = mapPoints(visits, places, 'visits');
    const standard = mapPoints(visits, places, 'places');
    expect(actual.points[0]).toMatchObject({
      position: { latitude: 12.1, longitude: 34.2 },
      place_id: 'a',
      visit_ids: ['one'],
      label: 'Place a',
    });
    expect(standard.points[0]).toMatchObject({
      position: { latitude: 12, longitude: 34 },
      place_id: 'a',
      visit_ids: ['one'],
    });
    expect(actual.points[0].id).not.toBe(standard.points[0].id);
    expect(actual.unlocated_visit_ids).toEqual([]);
    expect(standard.unlocated_visit_ids).toEqual([]);
  });

  test('groups exact repeat visits at one place without rounding neighboring visits', () => {
    const places = [place('a', { latitude: 12, longitude: 34 })];
    const visits = [
      visit('one', 'a', { latitude: 12.000001, longitude: 34 }),
      visit('two', 'a', { latitude: 12.000001, longitude: 34 }),
      visit('three', 'a', { latitude: 12.000002, longitude: 34 }),
    ];
    const actual = mapPoints(visits, places, 'visits');
    expect(actual.points).toHaveLength(2);
    expect(actual.points[0].visit_ids).toEqual(['one', 'two']);
    expect(actual.points[1].visit_ids).toEqual(['three']);
    const standard = mapPoints(visits, places, 'places');
    expect(standard.points).toHaveLength(1);
    expect(standard.points[0].visit_ids).toEqual(['one', 'two', 'three']);
    expect(
      mapPoints([...visits].reverse(), places, 'visits')
        .points.map((point) => point.id)
        .sort(),
    ).toEqual(actual.points.map((point) => point.id).sort());
  });

  test('events map to their photo coordinates and keep distinct titles at a shared pin', () => {
    const position = { latitude: 12, longitude: -34 };
    const first = { ...visit('one', 'a', position), place_id: null, title: 'Morning at the lake' };
    const second = { ...first, id: 'two', title: 'Evening at the lake' };
    const events = [first, second];
    expect(mapPoints(events, [], 'visits').points.map(({ label }) => label)).toEqual(
      events.map(({ title }) => title),
    );
    expect(mapPoints(events, [], 'places')).toEqual({
      points: [],
      unlocated_visit_ids: ['one', 'two'],
    });
    const named_place = place('a', { latitude: 12, longitude: -35 });
    const linked = [{ ...first, place_id: named_place.id }];
    expect(mapPoints(linked, [named_place], 'places').points[0]).toMatchObject({
      label: named_place.name,
      position: named_place.position,
    });
    expect(mapPoints(linked, [named_place], 'visits').points[0]).toMatchObject({
      label: first.title,
      position,
    });
  });

  test('missing positions are reported per visit without borrowing another location', () => {
    const places = [
      place('reference-only', { latitude: 12, longitude: 34 }),
      place('actual-only', null),
    ];
    const visits = [
      visit('one', 'reference-only', null),
      visit('two', 'actual-only', { latitude: 12.1, longitude: 34.2 }),
      visit('three', 'actual-only', null),
    ];
    const actual = mapPoints(visits, places, 'visits');
    expect(actual.points.flatMap((point) => point.visit_ids)).toEqual(['two']);
    expect(actual.unlocated_visit_ids).toEqual(['one', 'three']);
    const standard = mapPoints(visits, places, 'places');
    expect(standard.points.flatMap((point) => point.visit_ids)).toEqual(['one']);
    expect(standard.unlocated_visit_ids).toEqual(['two', 'three']);
  });

  test('different named places remain selectable even at identical coordinates', () => {
    const position = { latitude: 12, longitude: 34 };
    const places = [place('a', position), place('b', position), place('unvisited', position)];
    const visits = [visit('one', 'a', position), visit('two', 'b', position)];
    for (const mode of ['visits', 'places'] as const) {
      const result = mapPoints(visits, places, mode);
      expect(result.points).toHaveLength(2);
      expect(new Set(result.points.map((point) => point.id)).size).toBe(2);
      expect(result.points.map((point) => point.place_id)).toEqual(['a', 'b']);
    }
  });

  test('empty selections and invalid references do not invent map points', () => {
    expect(mapPoints([], [place('a', { latitude: 12, longitude: 34 })], 'places')).toEqual({
      points: [],
      unlocated_visit_ids: [],
    });
    expect(() => mapPoints([visit('one', 'missing', null)], [], 'visits')).toThrow('missing place');
  });

  test('produced positions and visit lists do not alias the input journal', () => {
    const position = { latitude: 12, longitude: 34 };
    const places = [place('a', position)];
    const visits = [visit('one', 'a', position)];
    const result = mapPoints(visits, places, 'places');
    result.points[0].position.latitude = 0;
    result.points[0].visit_ids.push('two');
    expect(places[0].position).toEqual({ latitude: 12, longitude: 34 });
    expect(visits).toHaveLength(1);
    expect(visits[0].actual_location?.latitude).toBe(12);
  });
});

describe('coordinate bounds', () => {
  const points = (...positions: Coordinates[]) => positions.map((position) => ({ position }));

  test('empty and single-point selections have explicit unpadded bounds', () => {
    expect(fitCoordinates([])).toBeNull();
    expect(fitCoordinates(points({ latitude: 12, longitude: 34 }))).toEqual({
      south: 12,
      north: 12,
      west: 34,
      east: 34,
      center: { latitude: 12, longitude: 34 },
      latitude_span: 0,
      longitude_span: 0,
    });
  });

  test('fits ordinary coordinates and leaves input order intact', () => {
    const input = points({ latitude: 20, longitude: 40 }, { latitude: 10, longitude: 30 });
    expect(fitCoordinates(input)).toEqual({
      south: 10,
      north: 20,
      west: 30,
      east: 40,
      center: { latitude: 15, longitude: 35 },
      latitude_span: 10,
      longitude_span: 10,
    });
    expect(input[0].position).toEqual({ latitude: 20, longitude: 40 });
  });

  test('uses the minimal longitude arc across the date line', () => {
    expect(
      fitCoordinates(points({ latitude: -5, longitude: 179 }, { latitude: 5, longitude: -179 })),
    ).toEqual({
      south: -5,
      north: 5,
      west: 179,
      east: 181,
      center: { latitude: 0, longitude: -180 },
      latitude_span: 10,
      longitude_span: 2,
    });
  });

  test('handles the date line itself and repeated points without a 360-degree span', () => {
    const result = fitCoordinates(
      points(
        { latitude: 0, longitude: 180 },
        { latitude: 0, longitude: -180 },
        { latitude: 0, longitude: 180 },
      ),
    );
    expect(result?.west).toBe(-180);
    expect(result?.east).toBe(-180);
    expect(result?.longitude_span).toBe(0);
  });

  test('is stable for antipodal points and independent of point order', () => {
    const input = points({ latitude: -90, longitude: 0 }, { latitude: 90, longitude: 180 });
    expect(fitCoordinates(input)).toEqual(fitCoordinates([...input].reverse()));
    expect(fitCoordinates(input)?.longitude_span).toBe(180);
    expect(fitCoordinates(input)?.latitude_span).toBe(180);
  });

  test('rejects unusable coordinates before calculating a viewport', () => {
    expect(() => fitCoordinates(points({ latitude: NaN, longitude: 0 }))).toThrow('Latitude');
    expect(() => fitCoordinates(points({ latitude: 0, longitude: 181 }))).toThrow('longitude');
  });
});
