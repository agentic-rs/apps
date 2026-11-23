import { useEffect, useMemo, useRef } from 'react';
import {
  fitMapPoints,
  useDayRouteLine,
  useLeafletMap,
  useMapFit,
  useMapTiles,
  type MapPadding,
} from '../lib/leaflet-map';
import { dayMapPlaces, normalizeLongitude, visiblePosition } from '../lib/map';
import type { DaySearchArea } from '../lib/place-comparison';
import type { StopSearchResult } from '../lib/stop-lookup';
import type { PlannedStop } from '../lib/types';
import { Icon } from './Icon';
import { DayPlacePins, PlaceMapButton } from './PlaceMapPins';
import type { ContinuingStay } from '../lib/hotel-stays';
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

export default function PlaceResultsMap({
  places,
  area,
  stops,
  stays,
  selected_id,
  onSelect,
  native,
  active,
}: {
  places: StopSearchResult[];
  area?: DaySearchArea;
  stops: PlannedStop[];
  stays: ContinuingStay[];
  selected_id: string;
  onSelect(id: string): void;
  native: boolean;
  active: boolean;
}) {
  const { container, map, zoom } = useLeafletMap(0);
  const { groups } = useMemo(() => dayMapPlaces(stops, stays), [stops, stays]);
  const result_locations = new Set(
    places.map(({ position }) => `${position.latitude}/${normalizeLongitude(position.longitude)}`),
  );
  const fit_points = useMemo(() => (area ? [...places, area] : places), [places, area]);
  const fitResults = useMapFit(
    map,
    active,
    [
      area?.id,
      area?.position.latitude,
      area?.position.longitude,
      ...[...result_locations].sort(),
    ].join(';'),
    fit_points,
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
      {map && (
        <DayPlacePins
          map={map}
          groups={groups}
          shared_locations={result_locations}
          search_area={area}
        />
      )}
      {map &&
        places.map((place) => (
          <PlaceMapButton
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
          </PlaceMapButton>
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
