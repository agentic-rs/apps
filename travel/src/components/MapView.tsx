import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as LeafletMap, Point } from 'leaflet';
import { MapMarker } from './MapMarker';
import { formatVisitDate, formatVisitTime } from '../lib/dates';
import { dayMapPlaces, groupPins, mapPoints, visiblePosition, type MapMode } from '../lib/map';
import type { ContinuingStay } from '../lib/hotel-stays';
import {
  useDayRouteLine,
  useLeafletMap,
  useMapFit,
  useMapTiles,
  type MapPadding,
} from '../lib/leaflet-map';
import '../map.css';
import { formatCoordinates, formatEntryCount, visitTitle } from '../lib/model';
import { type CheckIn, type Place, type PlannedStop, type TravelPlatform } from '../lib/types';
import { Icon } from './Icon';
import { useBackLayer } from '../lib/back-navigation';
import { Photo } from './Photo';
import { MapStayButton, MapStopButton, MapStopList } from './MapStopList';
import type { MoveStop } from './StopOrderButtons';

const map_modes = {
  stops: {
    label: 'Day route',
    position_label: 'planned stop',
    description: 'Straight lines show your stop order',
    region: 'Map of planned stops in itinerary order',
    missing: 'without stop coordinates',
    empty_title: 'No stops on this day',
    empty_help: 'Add a stop to your itinerary to start a route.',
    position_help: 'Add coordinates to a stop to place it on the map.',
  },
  visits: {
    label: 'Actual visits',
    position_label: 'actual visit',
    description: 'Where your visits happened',
    region: 'Map of actual visit locations',
    missing: 'without visit coordinates',
    empty_title: 'Your journeys will take shape here.',
    empty_help: 'Check in on a trip to put a memory on the map.',
    position_help: 'Add actual visit coordinates to see your entries here.',
  },
  places: {
    label: 'Named places',
    position_label: 'place reference',
    description: 'Standard positions of named places',
    region: 'Map of named place reference locations',
    missing: 'without place coordinates',
    empty_title: 'Your journeys will take shape here.',
    empty_help: 'Check in on a trip to put a memory on the map.',
    position_help: 'Add reference coordinates to your named places to see them here.',
  },
};

function dayMapPadding({ y: height }: Point): MapPadding {
  // Leave room for the right-hand zoom buttons and the full pin bubbles. The
  // caption is hidden on short maps, so more of that height can show the route.
  const top = Math.min(height <= 360 ? 106 : 156, Math.floor(height * 0.45));
  return {
    paddingTopLeft: [32, top],
    paddingBottomRight: [82, Math.min(90, Math.floor(height * 0.25))],
  };
}

function JournalMapPin({
  map,
  group,
  mode,
  selected,
  onSelect,
}: {
  map: LeafletMap;
  group: ReturnType<typeof groupPins>[number] | ReturnType<typeof dayMapPlaces>['groups'][number];
  mode: MapMode;
  selected: boolean;
  onSelect(): void;
}) {
  const { latitude, longitude } = group.position;
  const route = 'numbers' in group ? group : undefined;
  const hotel = route && !route.numbers.length;
  const anchor = route ? 21 : 43;
  const label = route
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
        className={`journal-map-pin ${mode}${hotel ? ' stay' : ''}${selected ? ' selected' : ''}`}
        title={label}
        aria-label={label}
        aria-pressed={selected}
        data-latitude={latitude}
        data-longitude={longitude}
        data-stop-numbers={route?.numbers.length ? route.numbers.join(',') : undefined}
        data-visit-count={route ? undefined : group.entry_ids.length}
        onFocus={(event) => {
          if (event.currentTarget.matches(':focus-visible'))
            map.panInside(visiblePosition(group.position, map.getCenter().lng), {
              ...dayMapPadding(map.getSize()),
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
            {hotel ? (
              <Icon name="bed" size={18} />
            ) : route ? (
              route.numbers[0]
            ) : (
              group.entry_ids.length
            )}
          </span>
          {route && group.points.length > 1 && (
            <small className="map-pin-extra">
              {route.has_stay && !hotel && <Icon name="bed" size={12} />}+{group.points.length - 1}
            </small>
          )}
        </span>
      </button>
    </MapMarker>
  );
}

export default function MapView({
  stops,
  continuing_stays,
  visits,
  places,
  platform,
  onOpenVisit,
  onOpenStop,
  onMoveStop,
  onReorderStops,
  onOptimize,
  active,
}: {
  stops: PlannedStop[];
  continuing_stays: ContinuingStay[];
  visits: CheckIn[];
  places: Place[];
  platform: TravelPlatform;
  onOpenVisit(id: string): void;
  onOpenStop(id: string): void;
  onMoveStop: MoveStop;
  onReorderStops(): void;
  onOptimize(): void;
  active: boolean;
}) {
  const { container, map, zoom } = useLeafletMap();
  const panel = useRef<HTMLElement>(null);
  const [mode, setMode] = useState<MapMode>('stops');
  const [selected_key, setSelectedKey] = useState<string | null>(null);
  const [unlocated_open, setUnlocatedOpen] = useState(false);
  const data = useMemo(() => {
    if (mode === 'stops') return dayMapPlaces(stops, continuing_stays);
    const data = mapPoints(visits, places, mode);
    return { ...data, groups: groupPins(data.points) };
  }, [stops, continuing_stays, visits, places, mode]);
  const { groups } = data;
  const numbers = useMemo(() => new Map(stops.map((stop, index) => [stop.id, index + 1])), [stops]);
  const fit_key = `${mode}:${groups.map((group) => group.key).join(';')}`;
  const selected = groups.find((group) => group.key === selected_key);
  function closeSelection() {
    setSelectedKey(null);
    setUnlocatedOpen(false);
  }
  useBackLayer(Boolean(selected) || unlocated_open, closeSelection);
  const visible_ids = new Set(unlocated_open ? data.unlocated_ids : (selected?.entry_ids ?? []));
  const selected_visits = (mode === 'stops' ? [] : visits)
    .filter((visit) => visible_ids.has(visit.id))
    .sort((a, b) => b.visited_at.localeCompare(a.visited_at));
  const places_by_id = new Map(places.map((place) => [place.id, place]));
  const selected_stops = mode === 'stops' ? stops.filter((stop) => visible_ids.has(stop.id)) : [];
  const selected_stays =
    mode === 'stops' ? continuing_stays.filter(({ stop }) => visible_ids.has(stop.id)) : [];
  const total = mode === 'stops' ? stops.length + continuing_stays.length : visits.length;
  const selection_count = selected_stops.length + selected_stays.length + selected_visits.length;
  function displayCount(count: number, route_stops: number, stays: number) {
    if (mode !== 'stops') return formatEntryCount(count);
    if (!stays) return `${count} ${count === 1 ? 'stop' : 'stops'}`;
    if (!route_stops) return `${count} ${count === 1 ? 'hotel stay' : 'hotel stays'}`;
    return `${count} places`;
  }
  const labels = map_modes[mode];
  const selected_names = selected ? [...new Set(selected.points.map((point) => point.label))] : [];

  useEffect(() => {
    setSelectedKey(null);
    setUnlocatedOpen(false);
  }, [stops, continuing_stays, visits]);

  const fitPins = useMapFit(map, active, fit_key, data.points, dayMapPadding);
  const { tile_failures, retryTiles } = useMapTiles(map, platform.native, active);

  useDayRouteLine(map, stops, active && mode === 'stops');

  useEffect(() => {
    if (!map || !active || !selected || unlocated_open) return;
    const frame = requestAnimationFrame(() => {
      const panel_height = Math.min(panel.current?.clientHeight ?? 160, map.getSize().y * 0.45);
      map.panInside(visiblePosition(selected.position, map.getCenter().lng), {
        paddingTopLeft: [32, 100],
        paddingBottomRight: [60, panel_height + 28],
        animate: false,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [map, active, selected_key, selected, unlocated_open, groups]);

  function chooseMode(next: MapMode) {
    setMode(next);
    setSelectedKey(null);
    setUnlocatedOpen(false);
  }

  return (
    <div className="map-workspace" hidden={!active}>
      <section className="map-view" aria-label="Travel map">
        <div
          className="journal-map-canvas"
          ref={container}
          role="region"
          aria-label={labels.region}
        />
        {map &&
          groups.map((group) => (
            <JournalMapPin
              key={group.key}
              map={map}
              group={group}
              mode={mode}
              selected={selected_key === group.key && !unlocated_open}
              onSelect={() => {
                setSelectedKey(group.key);
                setUnlocatedOpen(false);
              }}
            />
          ))}
        <div className="map-top-tools">
          <div className="map-mode-switch" role="group" aria-label="Map positions">
            {(['stops', 'visits', 'places'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={mode === option}
                onClick={() => chooseMode(option)}
              >
                {map_modes[option].label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="map-square-control"
            aria-label="Fit all map pins"
            title="Fit all pins"
            onClick={fitPins}
          >
            <Icon name="compass" size={20} />
          </button>
        </div>
        <div className="map-caption">
          <span className={`map-legend-dot ${mode}`} />
          <span>
            {mode === 'stops' && !stops.length && continuing_stays.length
              ? 'Hotel stays'
              : labels.description}
            <small>
              {total - data.unlocated_ids.length} of{' '}
              {displayCount(total, stops.length, continuing_stays.length)} on the map
            </small>
          </span>
        </div>
        <div className="map-zoom-controls" aria-label="Map zoom">
          <button
            type="button"
            aria-label="Zoom in"
            disabled={zoom >= 19}
            onClick={() => map?.zoomIn()}
          >
            <Icon name="plus" size={19} />
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            disabled={zoom <= 2}
            onClick={() => map?.zoomOut()}
          >
            <span aria-hidden="true">−</span>
          </button>
        </div>
        {data.points.length === 0 && !unlocated_open && (
          <div className="map-empty-message">
            <Icon name="pin" size={26} />
            <strong>{total ? 'Coordinates needed' : labels.empty_title}</strong>
            <span>{total ? labels.position_help : labels.empty_help}</span>
            {tile_failures > 0 && (
              <span className="map-empty-offline" role="status">
                Map background unavailable.{' '}
                <button type="button" onClick={retryTiles}>
                  Retry
                </button>
              </span>
            )}
          </div>
        )}
        {data.unlocated_ids.length > 0 && !selected && !unlocated_open && (
          <button
            className="map-missing-button"
            type="button"
            onClick={() => {
              setUnlocatedOpen(true);
              setSelectedKey(null);
            }}
          >
            <Icon name="pin" size={16} />
            <span>
              {data.unlocated_ids.length}{' '}
              {mode === 'stops' && continuing_stays.length
                ? 'without map coordinates'
                : labels.missing}
            </span>
            <Icon name="arrow" size={15} />
          </button>
        )}
        {(selected || unlocated_open) && (
          <section
            className="map-selection-card"
            ref={panel}
            aria-label={`${mode === 'stops' ? 'Stops' : 'Entries'} ${unlocated_open ? 'without coordinates' : 'at selected map pin'}`}
          >
            <header>
              <div>
                <span className="map-card-kicker">
                  {unlocated_open
                    ? 'NOT ON THIS MAP'
                    : displayCount(
                        selection_count,
                        selected_stops.length,
                        selected_stays.length,
                      ).toUpperCase()}
                </span>
                <h2>
                  {unlocated_open
                    ? 'Missing coordinates'
                    : selected_names.length === 1
                      ? selected_names[0]
                      : mode === 'stops'
                        ? selected_stays.length
                          ? 'Places at this position'
                          : 'Stops at this position'
                        : 'Moments at this position'}
                </h2>
                {selected && (
                  <p>
                    {formatCoordinates(selected.position)}{' '}
                    {(!selected_stops.length || !selected_stays.length) && (
                      <span>· {selected_stays.length ? 'hotel stay' : labels.position_label}</span>
                    )}
                  </p>
                )}
                {tile_failures > 0 && !data.points.length && (
                  <p role="status">Map background unavailable.</p>
                )}
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close map selection"
                onClick={closeSelection}
              >
                <Icon name="close" size={19} />
              </button>
            </header>
            <div className="map-selected-visits">
              {selected_stops.map((stop) => (
                <MapStopButton
                  key={stop.id}
                  stop={stop}
                  number={numbers.get(stop.id)!}
                  onOpen={onOpenStop}
                />
              ))}
              {selected_stays.map((stay) => (
                <MapStayButton key={stay.stop.id} stay={stay} onOpen={onOpenStop} />
              ))}
              {selected_visits.map((visit) => {
                const place =
                  visit.place_id === null ? undefined : places_by_id.get(visit.place_id);
                const title = visitTitle(visit, place);
                return (
                  <article className="map-visit-row" key={visit.id}>
                    {visit.photos[0] ? (
                      <div className="map-visit-photo">
                        <Photo photo={visit.photos[0]} platform={platform} alt={title} />
                      </div>
                    ) : (
                      <span className="map-visit-symbol">
                        <Icon name="pin" size={22} />
                      </span>
                    )}
                    <div className="map-visit-copy">
                      <h3>{title}</h3>
                      <p>
                        {formatVisitDate(visit.visited_at, visit.utc_offset_minutes)} ·{' '}
                        {formatVisitTime(visit.visited_at, visit.utc_offset_minutes)}
                      </p>
                      {visit.notes && <p className="map-visit-note">{visit.notes}</p>}
                      <button
                        type="button"
                        className="map-open-visit"
                        onClick={() => onOpenVisit(visit.id)}
                      >
                        {visit.title ? 'View event' : 'View check-in'}
                        <Icon name="arrow" size={14} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </section>
      {tile_failures > 0 && data.points.length > 0 && (
        <div className="map-tile-status" role="status">
          <span>Map background unavailable. Your pins still work.</span>
          <button type="button" onClick={retryTiles}>
            Retry
          </button>
        </div>
      )}
      {mode === 'stops' && (stops.length > 0 || continuing_stays.length > 0) && (
        <MapStopList
          key={stops[0]?.day ?? continuing_stays[0]?.stop.id}
          stops={stops}
          continuing_stays={continuing_stays}
          onOpenStop={onOpenStop}
          onMoveStop={onMoveStop}
          onReorderStops={onReorderStops}
          onOptimize={onOptimize}
        />
      )}
    </div>
  );
}
