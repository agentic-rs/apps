import { parseCoordinates, visitTitle } from './model';
import type { CheckIn, Coordinates, Place } from './types';

export type MapMode = 'visits' | 'places';

export interface MapPoint {
  id: string;
  position: Coordinates;
  place_id: string | null;
  visit_ids: string[];
  label: string;
}

export interface MapPointsResult {
  points: MapPoint[];
  unlocated_visit_ids: string[];
}

export interface CoordinateBounds {
  south: number;
  north: number;
  /** Normalized to [−180, 180). */
  west: number;
  /** May exceed 180 when the shortest arc crosses the date line. */
  east: number;
  center: Coordinates;
  latitude_span: number;
  longitude_span: number;
}

/**
 * Visit and reference positions remain separate: neither mode borrows the
 * other position when its own location is unknown. Exact repeat visits at
 * one named place share a selectable marker without rounding nearby stops.
 */
export function mapPoints(
  visits: readonly CheckIn[],
  places: readonly Place[],
  mode: MapMode,
): MapPointsResult {
  if (mode !== 'visits' && mode !== 'places')
    throw new Error('Choose visit or named-place map positions.');
  const places_by_id = new Map(places.map((place) => [place.id, place]));
  const points_by_id = new Map<string, MapPoint>();
  const unlocated_visit_ids: string[] = [];
  for (const visit of visits) {
    const place = visit.place_id === null ? undefined : places_by_id.get(visit.place_id);
    if (visit.place_id !== null && !place)
      throw new Error('A mapped check-in refers to a missing place.');
    const source = mode === 'visits' ? visit.actual_location : place?.position;
    if (!source) {
      unlocated_visit_ids.push(visit.id);
      continue;
    }
    const position = parseCoordinates(source);
    const point_id =
      mode === 'places'
        ? `place:${visit.place_id}`
        : visit.title
          ? `event:${visit.id}`
          : `visit:${visit.place_id}:${position.latitude}:${position.longitude}`;
    const point = points_by_id.get(point_id);
    if (point) {
      point.visit_ids.push(visit.id);
    } else {
      points_by_id.set(point_id, {
        id: point_id,
        position,
        place_id: visit.place_id,
        visit_ids: [visit.id],
        label: mode === 'places' && place ? place.name : visitTitle(visit, place),
      });
    }
  }
  return { points: [...points_by_id.values()], unlocated_visit_ids };
}

function normalizeLongitude(value: number): number {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

/**
 * Unpadded geographic bounds. Longitudes use the smallest circular arc, so
 * stops at 179° and −179° fit a 2° view, not a nearly whole-world rectangle.
 * Renderers choose padding, minimum zoom, and projection-specific pole limits.
 */
export function fitCoordinates(
  points: readonly { position: Coordinates }[],
): CoordinateBounds | null {
  if (points.length === 0) return null;
  const positions = points.map((point) => parseCoordinates(point.position));
  const longitudes = positions
    .map((position) => normalizeLongitude(position.longitude))
    .sort((a, b) => a - b);
  let gap_index = 0;
  let largest_gap = -1;
  for (let index = 0; index < longitudes.length; index++) {
    const next =
      longitudes[(index + 1) % longitudes.length] + (index === longitudes.length - 1 ? 360 : 0);
    const gap = next - longitudes[index];
    if (gap > largest_gap) {
      largest_gap = gap;
      gap_index = index;
    }
  }
  const west = longitudes[(gap_index + 1) % longitudes.length];
  const last = longitudes[gap_index];
  const east = last < west ? last + 360 : last;
  const south = positions.reduce(
    (minimum, position) => Math.min(minimum, position.latitude),
    Infinity,
  );
  const north = positions.reduce(
    (maximum, position) => Math.max(maximum, position.latitude),
    -Infinity,
  );
  const latitude_span = north - south;
  const longitude_span = east - west;
  return {
    south,
    north,
    west,
    east,
    center: {
      latitude: south + latitude_span / 2,
      longitude: normalizeLongitude(west + longitude_span / 2),
    },
    latitude_span,
    longitude_span,
  };
}
