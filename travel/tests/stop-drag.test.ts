import { expect, test } from 'bun:test';
import { stopDragScrollSpeed } from '../src/lib/use-stop-drag';

test('drag scrolling stays still between the edges and accelerates toward the nearest edge', () => {
  expect(stopDragScrollSpeed(200, 100, 300)).toBe(0);
  expect(stopDragScrollSpeed(124, 100, 300)).toBe(-360);
  expect(stopDragScrollSpeed(276, 100, 300)).toBe(360);
  expect(stopDragScrollSpeed(0, 100, 300)).toBe(-720);
  expect(stopDragScrollSpeed(400, 100, 300)).toBe(720);
});

test('a short or fully clipped scroll area never scrolls from its center', () => {
  expect(stopDragScrollSpeed(120, 100, 140)).toBe(0);
  expect(stopDragScrollSpeed(120, 130, 130)).toBe(0);
  expect(stopDragScrollSpeed(120, 140, 100)).toBe(0);
});
