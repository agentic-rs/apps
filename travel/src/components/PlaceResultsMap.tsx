import { useEffect, useMemo, useRef, type RefObject } from 'react';
import {
  fitMapPoints,
  useDayRouteLine,
  useLeafletMap,
  useMapFit,
  useMapTiles,
  type MapPadding,
} from '../lib/leaflet-map';
import { dayMapPlaces, normalizeLongitude, visiblePosition } from '../lib/map';
import type { DayPlaceResult, DaySearchArea } from '../lib/place-comparison';
import type { PlannedStop } from '../lib/types';
import { Icon } from './Icon';
import { ResultMapPins } from './ResultMapPins';
import type { ContinuingStay } from '../lib/hotel-stays';
import '../place-map-preview.css';
import '../place-results-map.css';

const resultsPadding = (): MapPadding => ({
  paddingTopLeft: [32, 46],
  paddingBottomRight: [32, 48],
});

// A search around a station can return a dozen venues within a few blocks.
const fitSearchArea: typeof fitMapPoints = (map, points, padding) =>
  fitMapPoints(map, points, padding, 17);

export default function PlaceResultsMap({
  results,
  area,
  stops,
  stays,
  selected_id,
  onSelect,
  card_title,
  saving,
  native,
  active,
}: {
  results: readonly DayPlaceResult[];
  area?: DaySearchArea;
  stops: PlannedStop[];
  stays: ContinuingStay[];
  selected_id: string;
  onSelect(id: string): void;
  card_title: RefObject<HTMLHeadingElement | null>;
  saving: boolean;
  native: boolean;
  active: boolean;
}) {
  const { container, map, zoom } = useLeafletMap(0);
  const places = useMemo(() => results.map(({ place }) => place), [results]);
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
    fitSearchArea,
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
      {map && active && (
        <ResultMapPins
          map={map}
          zoom={zoom}
          results={results}
          day_groups={groups}
          area={area}
          selected_id={selected_id}
          onSelect={onSelect}
          card_title={card_title}
          disabled={saving}
        />
      )}
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
