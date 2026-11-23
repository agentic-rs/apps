import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { divIcon, marker, type Map as LeafletMap, type Marker } from 'leaflet';
import {
  fitMapPoints,
  useDayRouteLine,
  useLeafletMap,
  useMapFit,
  useMapTiles,
  type MapPadding,
} from '../lib/leaflet-map';
import { groupPins, mapStops, normalizeLongitude, visiblePosition } from '../lib/map';
import type { StopSearchResult } from '../lib/stop-lookup';
import type { Coordinates, PlannedStop } from '../lib/types';
import { Icon } from './Icon';
import '../place-map-preview.css';
import '../place-results-map.css';

const resultsPadding = (): MapPadding => ({
  paddingTopLeft: [32, 46],
  paddingBottomRight: [32, 48],
});

const kind_icons = {
  sight: 'landmark',
  stay: 'bed',
  food: 'food',
  transport: 'route',
  other: 'pin',
} as const;

/** Leaflet positions the marker. A native button handles touch and keyboard activation. */
function MapButton({
  map,
  position,
  label,
  route,
  shared,
  selected,
  onClick,
  children,
}: {
  map: LeafletMap;
  position: Coordinates;
  label: string;
  route?: boolean;
  shared?: boolean;
  selected?: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  const [content] = useState(() => document.createElement('span'));
  const pin = useRef<Marker | null>(null);
  const { latitude, longitude } = position;
  useLayoutEffect(() => {
    const coordinate = () => visiblePosition({ latitude, longitude }, map.getCenter().lng);
    const current = marker(coordinate(), {
      interactive: false,
      keyboard: false,
      icon: divIcon({
        html: content,
        className: 'browse-map-marker',
        iconSize: [44, 44],
        iconAnchor: [22, route ? (shared ? 0 : 22) : 42],
      }),
    }).addTo(map);
    pin.current = current;
    const wrap = () => current.setLatLng(coordinate());
    map.on('moveend', wrap);
    return () => {
      map.off('moveend', wrap);
      current.remove();
      pin.current = null;
    };
  }, [map, content, latitude, longitude, route, shared]);
  useLayoutEffect(() => {
    pin.current?.setZIndexOffset(selected ? 2000 : route ? 0 : 600);
  }, [map, latitude, longitude, route, shared, selected]);

  return createPortal(
    <button
      type="button"
      className={route ? 'browse-route-pin' : 'browse-place-pin'}
      aria-label={label}
      title={label}
      aria-pressed={selected}
      onFocus={(event) => {
        if (event.currentTarget.matches(':focus-visible'))
          map.panInside(visiblePosition(position, map.getCenter().lng), {
            ...resultsPadding(),
            animate: false,
          });
      }}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>,
    content,
  );
}

export default function PlaceResultsMap({
  places,
  stops,
  selected_id,
  onSelect,
  native,
  active,
}: {
  places: StopSearchResult[];
  stops: PlannedStop[];
  selected_id: string;
  onSelect(id: string): void;
  native: boolean;
  active: boolean;
}) {
  const { container, map, zoom } = useLeafletMap(0);
  const groups = useMemo(() => groupPins(mapStops(stops).points), [stops]);
  const numbers = useMemo(() => new Map(stops.map((stop, index) => [stop.id, index + 1])), [stops]);
  const result_locations = new Set(
    places.map(({ position }) => `${position.latitude}/${normalizeLongitude(position.longitude)}`),
  );
  const fitResults = useMapFit(
    map,
    active,
    [...result_locations].join(';'),
    places,
    resultsPadding,
  );
  const { tile_failures, retryTiles } = useMapTiles(map, native, active);
  useDayRouteLine(map, stops, active);
  const selected = places.find((place) => place.id === selected_id);
  const previous_selection = useRef('');
  useEffect(() => {
    if (!active || !map || !selected || previous_selection.current === selected.id) return;
    previous_selection.current = selected.id;
    map.closePopup();
    map.panInside(visiblePosition(selected.position, map.getCenter().lng), {
      ...resultsPadding(),
      animate: false,
    });
  }, [map, active, selected]);

  return (
    <div className="browse-map">
      <div
        ref={container}
        className="place-map-canvas browse-map-canvas"
        role="region"
        aria-label="Map of place results"
      />
      {map &&
        groups.map((group) => {
          const sequence = group.points.map((point) => numbers.get(point.id)!);
          const labels = group.points.map(
            (point, index) => `Stop ${sequence[index]}, ${point.label}`,
          );
          return (
            <MapButton
              key={group.key}
              map={map}
              position={group.position}
              label={labels.join(' · ')}
              route
              shared={result_locations.has(group.key)}
              onClick={() => {
                const popup = document.createElement('div');
                for (const label of labels) {
                  const line = document.createElement('div');
                  line.textContent = label;
                  popup.append(line);
                }
                map.openPopup(popup, visiblePosition(group.position, map.getCenter().lng), {
                  maxWidth: 220,
                });
              }}
            >
              <span className="place-stop-badge">
                {sequence[0]}
                {sequence.length > 1 && <small>+{sequence.length - 1}</small>}
              </span>
            </MapButton>
          );
        })}
      {map &&
        places.map((place) => (
          <MapButton
            key={place.id}
            map={map}
            position={place.position}
            label={`Show ${place.title} on map`}
            selected={place.id === selected_id}
            onClick={() => {
              map.closePopup();
              onSelect(place.id);
            }}
          >
            <span className="browse-pin-badge">
              <Icon name={kind_icons[place.kind]} size={18} />
            </span>
          </MapButton>
        ))}
      {tile_failures > 0 && active && (
        <div className="place-map-status" role="status">
          Map background unavailable.
          <button type="button" onClick={retryTiles}>
            Retry
          </button>
        </div>
      )}
      <div className="browse-map-tools" role="group" aria-label="Map controls">
        <button
          type="button"
          aria-label="Fit search results"
          title="Fit search results"
          onClick={() => {
            map?.closePopup();
            fitResults();
          }}
        >
          <Icon name="locate" />
        </button>
        {groups.length > 0 && (
          <button
            type="button"
            aria-label="Fit results and day route"
            title="Fit results and day route"
            onClick={() => {
              if (!map) return;
              map.closePopup();
              fitMapPoints(map, [...places, ...groups], resultsPadding());
            }}
          >
            <Icon name="route" /> Day route
          </button>
        )}
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          onClick={() => map?.zoomOut()}
          disabled={zoom <= 0}
        >
          <span aria-hidden="true">−</span>
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          onClick={() => map?.zoomIn()}
          disabled={zoom >= 19}
        >
          <Icon name="plus" />
        </button>
      </div>
    </div>
  );
}
