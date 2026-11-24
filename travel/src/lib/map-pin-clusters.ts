import type { Coordinates } from './types';

type PinGroup = { key: string; position: Coordinates; anchor_y?: number };
type Pixel = { x: number; y: number };

// Project the top edge of each 44px-wide touch target, including mixed marker shapes.
const pin_width = 44;

/** Project into the world copy displayed by the map, at the current zoom.
 * Keep each cluster on its first actual pin so growing clusters cannot collide or form chains.
 */
export function clusterMapPins<T extends PinGroup>(
  groups: readonly T[],
  project: (position: Coordinates) => Pixel,
  pin_height = 48,
): { key: string; position: Coordinates; groups: T[] }[] {
  const clusters: { anchor: Pixel; groups: T[] }[] = [];
  // At most one cluster anchor can fit in each touch-target-sized cell.
  const cells = new Map<string, number>();
  for (const group of groups) {
    const projected = project(group.position);
    const point = { x: projected.x, y: projected.y - (group.anchor_y ?? 0) };
    const column = Math.floor(point.x / pin_width);
    const row = Math.floor(point.y / pin_height);
    let nearest = -1;
    let best_distance = Infinity;
    for (let y = -1; y <= 1; y++) {
      for (let x = -1; x <= 1; x++) {
        const index = cells.get([column + x, row + y].join(','));
        if (index === undefined) continue;
        const anchor = clusters[index].anchor;
        const dx = Math.abs(point.x - anchor.x);
        const dy = Math.abs(point.y - anchor.y);
        if (dx >= pin_width || dy >= pin_height) continue;
        const distance = dx * dx + dy * dy;
        if (distance < best_distance || (distance === best_distance && index < nearest)) {
          nearest = index;
          best_distance = distance;
        }
      }
    }
    if (nearest >= 0) {
      clusters[nearest].groups.push(group);
    } else {
      cells.set([column, row].join(','), clusters.length);
      clusters.push({ anchor: point, groups: [group] });
    }
  }

  return clusters.map(({ groups }) => ({
    key:
      groups.length === 1
        ? groups[0].key
        : 'cluster:' + JSON.stringify(groups.map((group) => group.key).sort()),
    position: groups[0].position,
    groups,
  }));
}
