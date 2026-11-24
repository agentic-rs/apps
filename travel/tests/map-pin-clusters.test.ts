import { expect, test } from 'bun:test';
import { visiblePosition } from '../src/lib/map';
import { clusterMapPins } from '../src/lib/map-pin-clusters';
import type { Coordinates } from '../src/lib/types';

function pin(key: string, x: number, y = 0) {
  return Object.freeze({ key, position: Object.freeze({ longitude: x, latitude: y }) });
}

const project = (position: Coordinates) => ({ x: position.longitude, y: position.latitude });

test('clusters overlapping touch rectangles and preserves each exact-position group', () => {
  const first = {
    ...pin('station', -1, -1),
    entry_ids: Object.freeze(['station', 'same-pin inn']),
  };
  const corner = pin('museum', 42, 46);
  const right_edge = pin('park', 43, -1);
  const bottom_edge = pin('gallery', -1, 47);
  const input = Object.freeze([first, corner, right_edge, bottom_edge]);
  const result = clusterMapPins(input, project);
  expect(result.map((cluster) => cluster.groups)).toEqual([
    [first, corner],
    [right_edge],
    [bottom_edge],
  ]);
  expect(result[0].position).toBe(first.position);
  expect(result[0].groups[0]).toBe(first);
  expect(result[1].key).toBe(right_edge.key);
  expect(clusterMapPins([], project)).toEqual([]);
});

test('chains do not merge separate tap targets, and later pins join their nearest visible anchor', () => {
  const [a, middle, b, closer_to_b, tie] = [
    pin('A', 0),
    pin('middle', 30),
    pin('B', 60),
    pin('near B', 43),
    pin('tie', 30, 1),
  ];
  const input = [a, middle, b, closer_to_b, tie];
  const result = clusterMapPins(input, project);
  expect(result.map((cluster) => cluster.groups)).toEqual([
    [a, middle, tie],
    [b, closer_to_b],
  ]);
  expect(result.map((cluster) => cluster.position)).toEqual([a.position, b.position]);
  expect(clusterMapPins([b, a, tie], project).map((cluster) => cluster.groups)).toEqual([
    [b, tie],
    [a],
  ]);
});

test('identity follows member position keys across reorderings while output keeps itinerary order', () => {
  const first = pin('a/b', 1);
  const second = pin('c', 2);
  const separate = pin('elsewhere', 75);
  const before = clusterMapPins([first, separate, second], project);
  const after = clusterMapPins([separate, second, first], project);
  expect(after.map((cluster) => cluster.key)).toEqual([before[1].key, before[0].key]);
  expect(after[1].groups).toEqual([second, first]);
  expect(after[1].position).toBe(second.position);
  expect(before[0].key).not.toBe(clusterMapPins([pin('a', 1), pin('b/c', 2)], project)[0].key);
});

test('pins across the date line cluster only when their displayed world copies overlap', () => {
  const group = [pin('east', 179.5), pin('west', -179.5)];
  function inView(center: number, pixels_per_degree: number) {
    return clusterMapPins(group, (position) => {
      const [latitude, longitude] = visiblePosition(position, center);
      return { x: longitude * pixels_per_degree, y: latitude * pixels_per_degree };
    });
  }
  expect(inView(180, 20)[0].groups).toEqual(group);
  expect(inView(-180, 20)).toEqual(inView(180, 20));
  expect(inView(0, 20)).toHaveLength(2);
  expect(inView(180, 50)).toHaveLength(2);
});
