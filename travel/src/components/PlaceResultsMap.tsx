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
  search_near_label,
  canSearchNear,
  onSearchNear,
  card_title,
  saving,
  native,
  active,
}: {
  results: readonly DayPlaceResult[];
  area?: DaySearchArea;
  stops: PlannedStop[];
  stays: ContinuingStay[];
  selected_id?: string;
  onSelect(id: string): void;
  search_near_label: string;
  canSearchNear(id: string): boolean;
  onSearchNear(id: string): void;
  card_title: RefObject<HTMLHeadingElement | null>;
  saving: boolean;
  native: boolean;
  active: boolean;
}) {
  const { container, map, zoom } = useLeafletMap(0);
  const places = useMemo(() => results.map(({ place }) => place), [results]);
  const { groups } = useMemo(() => dayMapPlaces(stops, stays), [stops, stays]);
  const has_search_points = Boolean(places.length || area);
  const fit_points = useMemo(() => {
    if (area) return [...places, area];
    return places.length ? places : groups;
  }, [places, area, groups]);
  const fit_locations = new Set(
    fit_points.map(
      ({ position }) => `${position.latitude}/${normalizeLongitude(position.longitude)}`,
    ),
  );
  const fitResults = useMapFit(
    map,
    active,
    [has_search_points ? 'search' : 'route', area?.id, ...[...fit_locations].sort()].join(';'),
    fit_points,
    resultsPadding,
    has_search_points ? fitSearchArea : fitMapPoints,
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
          search_near_label={search_near_label}
          canSearchNear={canSearchNear}
          onSearchNear={onSearchNear}
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
        {has_search_points && (
          <button
            type="button"
            aria-label={places.length ? 'Fit search results' : 'Fit search area'}
            title={places.length ? 'Fit search results' : 'Fit search area'}
            onClick={() => {
              map?.closePopup();
              fitResults();
            }}
          >
            <Icon name="locate" />
          </button>
        )}
        {groups.length > 0 && (
          <button
            type="button"
            aria-label={places.length ? 'Fit results and day route' : 'Fit day route'}
            title={places.length ? 'Fit results and day route' : 'Fit day route'}
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
