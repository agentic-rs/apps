import type { ReactNode } from 'react';
import { popup as leafletPopup, type Map as LeafletMap } from 'leaflet';
import { MapMarker } from './MapMarker';
import { visiblePosition, type dayMapPlaces } from '../lib/map';
import type { Coordinates } from '../lib/types';
import type { DaySearchArea } from '../lib/place-comparison';
import { Icon } from './Icon';

export const place_pin_anchor = { result: 42, route: 22, candidate: 44 } as const;
export type DayPinGroup = ReturnType<typeof dayMapPlaces>['groups'][number];

/** Leaflet positions the marker. A native button handles touch and keyboard activation. */
export function PlaceMapButton({
  map,
  position,
  label,
  kind = 'result',
  description,
  shared,
  numbers,
  marker_key,
  selected,
  opens_dialog,
  disabled,
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
  marker_key?: string;
  selected?: boolean;
  opens_dialog?: boolean;
  disabled?: boolean;
  onClick(button: HTMLButtonElement): void;
  children: ReactNode;
}) {
  const route = kind === 'route';
  const anchor_y = route && shared ? 0 : place_pin_anchor[kind];
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
        data-map-pin-key={marker_key}
        aria-label={label}
        title={label}
        aria-pressed={selected}
        aria-haspopup={opens_dialog ? 'dialog' : undefined}
        disabled={disabled}
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
          onClick(event.currentTarget);
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
  return leafletPopup({ maxWidth: 220 })
    .setContent(popup)
    .setLatLng(visiblePosition(position, map.getCenter().lng))
    .openOn(map);
}

export function DayPlacePins({
  map,
  groups,
  shared_locations,
  search_area,
}: {
  map: LeafletMap;
  groups: ReturnType<typeof dayMapPlaces>['groups'];
  shared_locations: ReadonlySet<string>;
  search_area?: DaySearchArea;
}) {
  return groups.map((group) => (
    <DayPlacePin
      key={group.key}
      map={map}
      group={group}
      shared={shared_locations.has(group.key)}
      search_area={search_area}
    />
  ));
}

export function DayPlacePin({
  map,
  group,
  shared,
  search_area,
  marker_key,
  onOpen,
  disabled,
}: {
  map: LeafletMap;
  group: DayPinGroup;
  shared?: boolean;
  search_area?: DaySearchArea;
  marker_key?: string;
  onOpen?(button: HTMLButtonElement, labels: string[]): void;
  disabled?: boolean;
}) {
  const { labels, numbers } = group;
  const is_origin = search_area && group.points.some((point) => point.id === search_area.id);
  const origin_label = is_origin ? `Search near ${search_area.title}` : undefined;
  const popup_labels = origin_label ? [origin_label, ...labels] : labels;
  return (
    <PlaceMapButton
      marker_key={marker_key}
      disabled={disabled}
      map={map}
      position={group.position}
      label={labels.join(' · ')}
      description={origin_label}
      kind="route"
      numbers={numbers}
      shared={shared}
      onClick={(button) =>
        onOpen ? onOpen(button, popup_labels) : openPlacePopup(map, group.position, popup_labels)
      }
    >
      <span
        className={numbers.length ? 'place-stop-badge' : 'place-stop-badge stay'}
        data-search-origin={is_origin ? '' : undefined}
      >
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
}
