import type { Map as LeafletMap, Point } from 'leaflet';
import { dayMapPlaces, groupPins, visiblePosition, type MapMode } from '../lib/map';
import { formatEntryCount } from '../lib/model';
import type { MapPadding } from '../lib/leaflet-map';
import type { PlannedStop } from '../lib/types';
import { Icon } from './Icon';
import { MapMarker } from './MapMarker';

export function JournalMapPin({
  map,
  group,
  marker_key,
  cluster,
  padding,
  mode,
  selected,
  onSelect,
}: {
  map: LeafletMap;
  group: ReturnType<typeof groupPins>[number] | ReturnType<typeof dayMapPlaces>['groups'][number];
  marker_key: string;
  cluster?: { stops: PlannedStop[]; numbers: number[] };
  padding(size: Point): MapPadding;
  mode: MapMode;
  selected: boolean;
  onSelect(): void;
}) {
  const { latitude, longitude } = group.position;
  const route = 'numbers' in group ? group : undefined;
  const hotel = !cluster && route && !route.numbers.length;
  const numbers = cluster?.numbers ?? route?.numbers;
  const anchor = route ? 21 : 43;
  const label = cluster
    ? `${cluster.stops.length} nearby places: ${cluster.stops.map((stop) => stop.title).join(' · ')}`
    : route
      ? route.labels.join(' · ')
      : `${[...new Set(group.points.map((point) => point.label))].join(', ')}: ${formatEntryCount(group.entry_ids.length)}`;
  return (
    <MapMarker
      map={map}
      position={group.position}
      anchor_y={anchor}
      height={48}
      z_index={selected ? 1000 : 0}
    >
      <button
        type="button"
        className={`journal-map-pin ${mode}${cluster ? ' map-pin-cluster' : ''}${hotel ? ' stay' : ''}${selected ? ' selected' : ''}`}
        title={label}
        aria-label={label}
        aria-pressed={selected}
        data-latitude={latitude}
        data-longitude={longitude}
        data-map-pin-key={marker_key}
        data-stop-numbers={numbers?.length ? numbers.join(',') : undefined}
        data-visit-count={route ? undefined : group.entry_ids.length}
        onFocus={(event) => {
          if (event.currentTarget.matches(':focus-visible'))
            map.panInside(visiblePosition(group.position, map.getCenter().lng), {
              ...padding(map.getSize()),
              animate: false,
            });
        }}
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
      >
        <span className="map-pin-bubble">
          <span>
            {cluster ? (
              <>
                <Icon name="layers" size={13} />
                {cluster.stops.length}
              </>
            ) : hotel ? (
              <Icon name="bed" size={18} />
            ) : route ? (
              route.numbers[0]
            ) : (
              group.entry_ids.length
            )}
          </span>
          {!cluster && route && group.points.length > 1 && (
            <small className="map-pin-extra">
              {route.has_stay && !hotel && <Icon name="bed" size={12} />}+{group.points.length - 1}
            </small>
          )}
        </span>
      </button>
    </MapMarker>
  );
}
