import { useEffect, useMemo } from 'react';
import {
  useDayRouteLine,
  useLeafletMap,
  useMapFit,
  useMapTiles,
  type MapPadding,
} from '../lib/leaflet-map';
import { dayMapPlaces } from '../lib/map';
import type { PlannedStop } from '../lib/types';
import { Icon } from './Icon';
import { openPlacePopup, PlaceMapButton } from './PlaceMapPins';
import '../place-map-preview.css';
import '../reorder-map.css';

const routePadding = (): MapPadding => ({
  paddingTopLeft: [28, 24],
  paddingBottomRight: [48, 35],
});

export default function ReorderMap({
  stops,
  native,
  highlighted_id,
}: {
  stops: readonly PlannedStop[];
  native: boolean;
  highlighted_id?: string | null;
}) {
  const { container, map } = useLeafletMap(0);
  const { groups } = useMemo(() => dayMapPlaces(stops, []), [stops]);
  const has_pins = groups.length > 0;
  // The locations determine the viewport. Moving a stop changes only its
  // number and route line, even if the traveler has panned or zoomed.
  const fit_key = groups
    .map(({ key }) => key)
    .sort()
    .join(';');
  const fitRoute = useMapFit(map, has_pins, fit_key, groups, routePadding);
  const { tile_failures, retryTiles } = useMapTiles(map, native, has_pins);
  useDayRouteLine(map, stops, has_pins);
  useEffect(() => {
    // A tapped pin's popup includes the old draft number.
    map?.closePopup();
  }, [map, stops]);

  return (
    <div className="reorder-map">
      <div
        ref={container}
        className="place-map-canvas reorder-map-canvas"
        role="region"
        aria-label="Draft route map"
        hidden={!has_pins}
      />
      {map &&
        groups.map((group) => {
          const highlighted = group.points.findIndex(({ id }) => id === highlighted_id);
          return (
            <PlaceMapButton
              key={group.key}
              map={map}
              position={group.position}
              label={group.labels.join(' · ')}
              numbers={group.numbers}
              kind="route"
              selected={highlighted >= 0}
              onClick={() => openPlacePopup(map, group.position, group.labels)}
            >
              <span className="place-stop-badge">
                {group.numbers[Math.max(0, highlighted)]}
                {group.numbers.length > 1 && <small>+{group.numbers.length - 1}</small>}
              </span>
            </PlaceMapButton>
          );
        })}
      {has_pins ? (
        <button
          type="button"
          className="reorder-map-fit"
          aria-label="Recenter day route"
          title="Recenter day route"
          onClick={() => {
            map?.closePopup();
            fitRoute();
          }}
        >
          <Icon name="locate" size={19} />
        </button>
      ) : (
        <p className="reorder-map-empty">No stops have map coordinates.</p>
      )}
      {has_pins && tile_failures > 0 && (
        <div className="reorder-map-status" role="status">
          Map tiles unavailable.
          <button type="button" aria-label="Retry map tiles" onClick={retryTiles}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
