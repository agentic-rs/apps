import { parseCoordinates, visitTitle } from './model';
import type { CheckIn, Coordinates, Place, PlannedStop } from './types';

export type MapMode = 'stops' | 'visits' | 'places';

export interface MapPoint {
  id: string;
  position: Coordinates;
  place_id: string | null;
  entry_ids: string[];
  label: string;
}

export interface MapPointsResult {
  points: MapPoint[];
  unlocated_ids: string[];
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
  mode: Exclude<MapMode, 'stops'>,
): MapPointsResult {
  if (mode !== 'visits' && mode !== 'places')
    throw new Error('Choose visit or named-place map positions.');
  const places_by_id = new Map(places.map((place) => [place.id, place]));
  const points_by_id = new Map<string, MapPoint>();
  const unlocated_ids: string[] = [];
  for (const visit of visits) {
    const place = visit.place_id === null ? undefined : places_by_id.get(visit.place_id);
    if (visit.place_id !== null && !place)
      throw new Error('A mapped check-in refers to a missing place.');
    const source = mode === 'visits' ? visit.actual_location : place?.position;
    if (!source) {
      unlocated_ids.push(visit.id);
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
      point.entry_ids.push(visit.id);
    } else {
      points_by_id.set(point_id, {
        id: point_id,
        position,
        place_id: visit.place_id,
        entry_ids: [visit.id],
        label: mode === 'places' && place ? place.name : visitTitle(visit, place),
      });
    }
  }
  return { points: [...points_by_id.values()], unlocated_ids };
}

export function mapStops(stops: readonly PlannedStop[]): MapPointsResult {
  const points: MapPoint[] = [];
  const unlocated_ids: string[] = [];
  for (const stop of stops) {
    if (stop.position) {
      points.push({
        id: stop.id,
        place_id: null,
        position: parseCoordinates(stop.position),
        entry_ids: [stop.id],
        label: stop.title,
      });
    } else {
      unlocated_ids.push(stop.id);
    }
  }
  return { points, unlocated_ids };
}

export function normalizeLongitude(value: number): number {
  if (value >= -180 && value < 180) return value;
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

export function visiblePosition(position: Coordinates, center_longitude: number): [number, number] {
  const longitude = normalizeLongitude(position.longitude);
  return [position.latitude, longitude + 360 * Math.round((center_longitude - longitude) / 360)];
}

/** Connect adjacent itinerary stops on the shortest longitude arc in the displayed world. */
export function routeLines(
  stops: readonly Pick<PlannedStop, 'position'>[],
  center_longitude: number,
): [number, number][][] {
  const lines: [number, number][][] = [];
  for (let index = 1; index < stops.length; index++) {
    const previous = stops[index - 1].position;
    const current = stops[index].position;
    if (!previous || !current) continue;
    const start = visiblePosition(previous, center_longitude);
    const end = visiblePosition(current, start[1]);
    if (start[0] === end[0] && start[1] === end[1]) continue;
    lines.push([start, end]);
    // When the pins sit at opposite edges of the displayed world, draw the short
    // segment in both copies so it still reaches both numbered markers.
    const displayed_end = visiblePosition(current, center_longitude);
    const worlds_apart = Math.round((displayed_end[1] - end[1]) / 360);
    if (worlds_apart) {
      lines.push([[start[0], start[1] + worlds_apart * 360], displayed_end]);
    }
  }
  return lines;
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
