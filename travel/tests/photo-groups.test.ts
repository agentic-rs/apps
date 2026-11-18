import { expect, test } from 'bun:test';
import { groupEventPhotos, type EventPhoto } from '../src/lib/photo-groups';
import type { Coordinates } from '../src/lib/types';

function shot(
  id: string,
  local_time: string | null,
  location: Coordinates | null = null,
  offset: number | null = 0,
): EventPhoto {
  return {
    asset: { id, path: `images/${id}.jpg`, mime_type: 'image/jpeg', size_bytes: 1 },
    metadata: { local_time, utc_offset_minutes: local_time ? offset : null, location },
  };
}

function ids(photos: EventPhoto[]): string[][] {
  return groupEventPhotos(photos).map((group) => group.photos.map((photo) => photo.id));
}

test('orders the selection by capture instant and splits at gaps or local midnight', () => {
  const photos = [
    shot('d', '2025-02-02T00:05'),
    shot('a', '2025-02-01T17:00'),
    shot('c', '2025-02-01T23:45'),
    shot('b', '2025-02-01T19:00'),
  ];
  expect(ids(photos)).toEqual([['a', 'b'], ['c'], ['d']]);
  expect(photos.map((photo) => photo.asset.id)).toEqual(['d', 'a', 'c', 'b']);
});

test('groups a long visit using gaps between consecutive photos and the first GPS fix', () => {
  const location = { latitude: 0, longitude: 0 };
  const photos = [
    shot('arrival', '2025-02-01T10:00'),
    shot('first-fix', '2025-02-01T12:00', location),
    shot('stripped', '2025-02-01T14:00'),
    shot('nearby', '2025-02-01T14:05', { latitude: 0, longitude: 0.008 }),
    shot('next-stop', '2025-02-01T14:10', { latitude: 0, longitude: 0.015 }),
  ];
  const groups = groupEventPhotos(photos);
  expect(groups[0]).toEqual({
    local_time: '2025-02-01T10:00',
    utc_offset_minutes: 0,
    location,
    photos: photos.slice(0, 4).map((photo) => photo.asset),
  });
  expect(groups[1].photos).toEqual([photos[4].asset]);
});

test('uses geographic distance near the poles and across the antimeridian', () => {
  const photos = [179.97, -179.97, -179.9].map((longitude, index) =>
    shot(String(index), '2025-02-01T10:00', { latitude: 85, longitude }),
  );
  expect(ids(photos)).toEqual([['0', '1'], ['2']]);
});

test('keeps zoned and unzoned clocks independent and keeps undated photos separate', () => {
  const photos = [
    shot('undated-one', null),
    shot('unknown-later', '2025-02-01T11:00', null, null),
    shot('zoned-later', '2025-02-01T09:30', null, 0),
    shot('zoned-earlier', '2025-02-01T12:00', null, 240),
    shot('unknown-earlier', '2025-02-01T10:00', null, null),
    shot('undated-two', null),
  ];
  expect(ids(photos)).toEqual([
    ['zoned-earlier', 'zoned-later'],
    ['unknown-earlier', 'unknown-later'],
    ['undated-one'],
    ['undated-two'],
  ]);
});

test('every photo appears exactly once when a burst exceeds the per-event limit', () => {
  const photos = Array.from({ length: 42 }, (_, i) => shot(String(i), '2025-02-01T10:00'));
  const groups = groupEventPhotos(photos);
  expect(groups.map((group) => group.photos.length)).toEqual([20, 20, 2]);
  expect(groups.flatMap((group) => group.photos)).toEqual(photos.map((photo) => photo.asset));
  expect(groupEventPhotos([])).toEqual([]);
});
