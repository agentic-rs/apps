import { distanceKm } from './distance';
import type { Journal, PlannedStop } from './types';

export { distanceKm as legDistanceKm } from './distance';

/** A partial route has no total distance. A fully located route with no legs measures zero. */
export function routeDistanceKm(stops: readonly PlannedStop[]): number | null {
  let total = 0;
  let previous: PlannedStop['position'] = null;
  for (const stop of stops) {
    if (!stop.position) return null;
    if (previous) total += distanceKm(previous, stop.position);
    previous = stop.position;
  }
  return total;
}

/**
 * Keep the endpoints fixed and try reversing interior sections (2-opt).
 * A reversal only changes the two boundary legs. Restrict the search window on
 * long days so previews use linear space and bounded comparisons per stop.
 */
export function suggestDayRoute(
  stops: readonly PlannedStop[],
  start_id: string,
  end_id: string,
): PlannedStop[] {
  const by_id = new Map(stops.map((stop) => [stop.id, stop]));
  const start = by_id.get(start_id);
  const end = by_id.get(end_id);
  if (!start || !end || start.id === end.id)
    throw new Error('Choose different start and end stops.');
  if (
    by_id.size !== stops.length ||
    stops.some((stop) => stop.trip_id !== start.trip_id || stop.day !== start.day)
  ) {
    throw new Error('Choose stops from a single trip day.');
  }
  if (stops.some((stop) => !stop.position))
    throw new Error('Add coordinates to each stop before arranging the route.');

  const route = [start, ...stops.filter((stop) => stop !== start && stop !== end), end];
  const comparison_budget = 16_384;
  const window = Math.max(1, Math.floor(comparison_budget / route.length));
  const minimum_gain_km = 1e-8;
  for (let pass = 0; pass < 4; pass++) {
    let improved = false;
    for (let left = 1; left < route.length - 2; left++) {
      const before = route[left - 1].position!;
      const first = route[left].position!;
      const incoming = distanceKm(before, first);
      let best_right = left;
      let best_gain = minimum_gain_km;
      const limit = Math.min(route.length - 2, left + window);
      for (let right = left + 1; right <= limit; right++) {
        const last = route[right].position!;
        const after = route[right + 1].position!;
        const gain =
          incoming + distanceKm(last, after) - distanceKm(before, last) - distanceKm(first, after);
        if (gain > best_gain) {
          best_gain = gain;
          best_right = right;
        }
      }
      if (best_right !== left) {
        const count = best_right - left + 1;
        route.splice(left, count, ...route.slice(left, best_right + 1).reverse());
        improved = true;
      }
    }
    if (!improved) break;
  }
  return route;
}

/** Reorder only the original trip/day slots. Preserve the latest stop objects and all links. */
export function applyDayRoute(
  journal: Journal,
  trip_id: string,
  day: string,
  original_ids: readonly string[],
  ordered_ids: readonly string[],
): Journal {
  const belongs = (stop: PlannedStop) => stop.trip_id === trip_id && stop.day === day;
  const current = journal.stops.filter(belongs);
  if (
    current.length !== original_ids.length ||
    current.some((stop, i) => stop.id !== original_ids[i])
  ) {
    throw new Error('The day’s stops changed. Review the route again.');
  }
  const by_id = new Map(current.map((stop) => [stop.id, stop]));
  if (
    current.length < 2 ||
    by_id.size !== current.length ||
    ordered_ids.length !== current.length ||
    new Set(ordered_ids).size !== current.length ||
    ordered_ids.some((id) => !by_id.has(id))
  ) {
    throw new Error('The route must contain every stop on the day exactly once.');
  }
  if (current.some((stop) => !stop.position))
    throw new Error('Add coordinates to each stop before arranging the route.');
  if (current.every((stop, i) => stop.id === ordered_ids[i])) return journal;

  let next = 0;
  const stops = journal.stops.map((stop) =>
    belongs(stop) ? by_id.get(ordered_ids[next++])! : stop,
  );
  return { ...journal, stops };
}
