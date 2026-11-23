import { useMemo } from 'react';
import type { ContinuingStay } from '../lib/hotel-stays';
import { formatDistance } from '../lib/distance';
import {
  useDayRouteLine,
  useLeafletMap,
  useMapFit,
  useMapTiles,
  type MapPadding,
} from '../lib/leaflet-map';
import { normalizeLongitude, previewDayStops, visiblePosition } from '../lib/map';
import type { Coordinates, PlannedStop } from '../lib/types';
import { Icon } from './Icon';
import { DayPlacePins, openPlacePopup, PlaceMapButton } from './PlaceMapPins';
import '../place-map-preview.css';

const previewPadding = (): MapPadding => ({
  paddingTopLeft: [36, 52],
  paddingBottomRight: [36, 70],
});

export default function PlaceMapPreview({
  title,
  position,
  stops,
  stays,
  insertion_index,
  native,
  context,
  editing_id,
}: {
  title: string;
  position: Coordinates;
  stops: PlannedStop[];
  stays: ContinuingStay[];
  insertion_index: number;
  native: boolean;
  context?: string;
  editing_id?: string;
}) {
  const { container, map, zoom } = useLeafletMap(0);
  const { groups, closest, route, candidate_number } = useMemo(
    () => previewDayStops(position, stops, insertion_index, editing_id, stays),
    [position, stops, insertion_index, editing_id, stays],
  );
  const points = useMemo(() => [{ position }, ...groups], [position, groups]);
  const candidate_key = `${position.latitude}/${normalizeLongitude(position.longitude)}`;
  const fit_key = [candidate_key, ...groups.map((group) => group.key)].join(';');
  const fitPins = useMapFit(map, true, fit_key, points, previewPadding);
  const { tile_failures, retryTiles } = useMapTiles(map, native, true);
  useDayRouteLine(map, route, true);
  const name = title.trim() || 'Selected place';
  const order = `Stop ${candidate_number} of ${route.length}`;

  return (
    <section className="place-map-preview">
      <header className="place-map-detail">
        <span className="place-map-context">{[context, order].filter(Boolean).join(' · ')}</span>
        <div className="place-map-title">
          <Icon name="pin" size={22} />
          <h3>{name}</h3>
        </div>
        {closest ? (
          <p>
            {closest.number === undefined ? 'Closest hotel' : 'Closest stop'}{' '}
            <strong>
              {closest.number !== undefined && `${closest.number} · `}
              {closest.title}
            </strong>
            <span>{formatDistance(closest.km)} straight-line distance</span>
          </p>
        ) : (
          <p>
            {route.length > 1 || stays.some(({ stop }) => stop.id !== editing_id)
              ? 'The other places on this day have no map coordinates.'
              : 'No other stops on this day.'}
          </p>
        )}
      </header>
      <div
        ref={container}
        className="place-map-canvas"
        role="region"
        aria-label="Map of selected place and day stops"
      />
      {map && (
        <>
          <DayPlacePins map={map} groups={groups} shared_locations={new Set([candidate_key])} />
          <PlaceMapButton
            map={map}
            position={position}
            label={`Selected place, ${name}`}
            description={order}
            kind="candidate"
            onClick={() => openPlacePopup(map, position, [`Selected place, ${name}`])}
          >
            <span className="place-candidate-tip">
              <span>{candidate_number}</span>
            </span>
          </PlaceMapButton>
        </>
      )}
      {tile_failures > 0 && (
        <div className="place-map-status" role="status">
          Map background unavailable.
          <button type="button" onClick={retryTiles}>
            Retry
          </button>
        </div>
      )}
      <div className="place-map-controls" role="group" aria-label="Map controls">
        <button
          type="button"
          onClick={() => {
            map?.closePopup();
            fitPins();
          }}
          aria-label="Fit all map pins"
        >
          <Icon name="map" /> Fit all
        </button>
        <button
          type="button"
          aria-label="Center on selected place"
          title="Center on selected place"
          onClick={() => {
            map?.closePopup();
            map?.setView(
              visiblePosition(position, map.getCenter().lng),
              Math.max(14, map.getZoom()),
              { animate: false },
            );
          }}
        >
          <Icon name="locate" />
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          disabled={zoom <= 0}
          onClick={() => map?.zoomOut()}
        >
          <span aria-hidden="true">−</span>
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          disabled={zoom >= 19}
          onClick={() => map?.zoomIn()}
        >
          <Icon name="plus" />
        </button>
      </div>
    </section>
  );
}
