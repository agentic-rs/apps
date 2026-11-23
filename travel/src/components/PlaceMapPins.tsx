import type { ReactNode } from 'react';
import type { Map as LeafletMap } from 'leaflet';
import { MapMarker } from './MapMarker';
import { visiblePosition, type dayMapPlaces } from '../lib/map';
import type { Coordinates } from '../lib/types';
import { Icon } from './Icon';

/** Leaflet positions the marker. A native button handles touch and keyboard activation. */
export function PlaceMapButton({
  map,
  position,
  label,
  kind = 'result',
  description,
  shared,
  numbers,
  selected,
  onClick,
  children,
}: {
  map: LeafletMap;
  position: Coordinates;
  label: string;
  kind?: 'result' | 'route' | 'candidate';
  description?: string;
  shared?: boolean;
  numbers?: number[];
  selected?: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  const route = kind === 'route';
  const anchor_y = route ? (shared ? 0 : 22) : kind === 'candidate' ? 44 : 42;
  return (
    <MapMarker
      map={map}
      position={position}
      anchor_y={anchor_y}
      z_index={selected ? 2000 : route ? 0 : 600}
    >
      <button
        type="button"
        className={route ? 'browse-route-pin' : 'browse-place-pin'}
        data-candidate-pin={kind === 'candidate' ? '' : undefined}
        aria-description={description}
        data-stop-numbers={numbers?.length ? numbers.join(',') : undefined}
        aria-label={label}
        title={label}
        aria-pressed={selected}
        onFocus={(event) => {
          if (event.currentTarget.matches(':focus-visible'))
            map.panInside(visiblePosition(position, map.getCenter().lng), {
              paddingTopLeft: [32, 46],
              paddingBottomRight: [32, 48],
              animate: false,
            });
        }}
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
      >
        {children}
      </button>
    </MapMarker>
  );
}

export function openPlacePopup(map: LeafletMap, position: Coordinates, labels: string[]) {
  const popup = document.createElement('div');
  for (const label of labels) {
    const line = document.createElement('div');
    line.textContent = label;
    popup.append(line);
  }
  map.openPopup(popup, visiblePosition(position, map.getCenter().lng), {
    maxWidth: 220,
  });
}

export function DayPlacePins({
  map,
  groups,
  shared_locations,
}: {
  map: LeafletMap;
  groups: ReturnType<typeof dayMapPlaces>['groups'];
  shared_locations: ReadonlySet<string>;
}) {
  return groups.map((group) => {
    const { labels, numbers } = group;
    return (
      <PlaceMapButton
        key={group.key}
        map={map}
        position={group.position}
        label={labels.join(' · ')}
        kind="route"
        numbers={numbers}
        shared={shared_locations.has(group.key)}
        onClick={() => openPlacePopup(map, group.position, labels)}
      >
        <span className={numbers.length ? 'place-stop-badge' : 'place-stop-badge stay'}>
          {numbers[0] ?? <Icon name="bed" size={18} />}
          {group.points.length > 1 && (
            <small>
              {group.has_stay && numbers.length > 0 && <Icon name="bed" size={12} />}+
              {group.points.length - 1}
            </small>
          )}
        </span>
      </PlaceMapButton>
    );
  });
}
