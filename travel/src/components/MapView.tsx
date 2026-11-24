import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Map as LeafletMap, Point } from 'leaflet';
import { MapMarker } from './MapMarker';
import { formatTripDates, formatVisitDate, formatVisitTime } from '../lib/dates';
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
import {
  stop_kind_labels,
  type CheckIn,
  type Place,
  type PlannedStop,
  type TravelPlatform,
  type Trip,
} from '../lib/types';
import { useNearbyPlaceSearch } from '../lib/use-nearby-place-search';
import { Icon } from './Icon';
import { useBackLayer } from '../lib/back-navigation';
import { Photo } from './Photo';
import { MapStopRow, MapStopList } from './MapStopList';
import { NearbyPlacesButton } from './NearbyPlacesButton';
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

function dayMapPadding({ x: width, y: height }: Point): MapPadding {
  // Leave room for the right-hand zoom buttons and the full pin bubbles. The
  // caption is hidden on short maps, so more of that height can show the route.
  const side_controls = window.matchMedia(
    '(orientation: landscape) and (max-height: 480px)',
  ).matches;
  const top = side_controls ? 16 : Math.min(height <= 360 ? 106 : 156, Math.floor(height * 0.45));
  return {
    paddingTopLeft: [32, top],
    paddingBottomRight: [Math.min(82, width / 4), Math.min(90, Math.floor(height * 0.25))],
  };
}

function focusNearby(scope: Element | null, stop_id: string) {
  const button = scope?.querySelector<HTMLButtonElement>(
    `[data-map-stop="${CSS.escape(stop_id)}"] .nearby-places-button`,
  );
  if (!button?.getClientRects().length) return false;
  button.focus({ preventScroll: true });
  button.scrollIntoView({ block: 'nearest' });
  return true;
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
  trip,
  day,
  stops,
  continuing_stays,
  visits,
  places,
  platform,
  onOpenVisit,
  onOpenStop,
  onAddStop,
  onMoveStop,
  onReorderStops,
  onOptimize,
  active,
}: {
  trip: Trip;
  day: string;
  stops: PlannedStop[];
  continuing_stays: ContinuingStay[];
  visits: CheckIn[];
  places: Place[];
  platform: TravelPlatform;
  onOpenVisit(id: string): void;
  onOpenStop(id: string): void;
  onAddStop(category: 'sight' | 'stay', stop: PlannedStop, restoreFocus: () => boolean): void;
  onMoveStop: MoveStop;
  onReorderStops(): void;
  onOptimize(): void;
  active: boolean;
}) {
  const { container, map, zoom } = useLeafletMap();
  const workspace = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const nearby_return = useRef<(() => boolean) | null>(null);
  const [sheet_host, setSheetHost] = useState<HTMLElement | null>(null);
  const [mode, setMode] = useState<MapMode>('stops');
  const [selection, setSelection] = useState<
    | { context: string; kind: 'pin'; key: string; entry_ids: string[]; fit_key: string }
    | { context: string; kind: 'unlocated' }
    | null
  >(null);
  const nearbyCategory = useNearbyPlaceSearch(trip, stops, continuing_stays);
  const data = useMemo(() => {
    if (mode === 'stops') return dayMapPlaces(stops, continuing_stays);
    const data = mapPoints(visits, places, mode);
    return { ...data, groups: groupPins(data.points) };
  }, [stops, continuing_stays, visits, places, mode]);
  const { groups } = data;
  const numbers = useMemo(() => new Map(stops.map((stop, index) => [stop.id, index + 1])), [stops]);
  const context = `${trip.id}/${day}/${mode}`;
  const fit_key = `${context}:${groups.map((group) => group.key).join(';')}`;
  const pin = selection?.kind === 'pin' && selection.context === context ? selection : null;
  const selected =
    pin &&
    groups.find(
      (group) => group.key === pin.key && group.entry_ids.some((id) => pin.entry_ids.includes(id)),
    );
  const unlocated_open =
    selection?.kind === 'unlocated' &&
    selection.context === context &&
    data.unlocated_ids.length > 0;
  function closeSelection() {
    setSelection(null);
  }
  useBackLayer(active && (Boolean(selected) || unlocated_open), closeSelection);
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
  const single_stop =
    selected && selection_count === 1 ? (selected_stops[0] ?? selected_stays[0]?.stop) : undefined;
  const single_category = single_stop && nearbyCategory(single_stop);
  const single_detail =
    single_stop &&
    [
      selected_stays.length
        ? day === single_stop.checkout_date
          ? 'Check-out'
          : 'Staying overnight'
        : single_stop.kind === 'stay'
          ? 'Check-in'
          : stop_kind_labels[single_stop.kind],
      single_stop.city,
      selected_stops.length ? single_stop.time : undefined,
    ]
      .filter(Boolean)
      .join(' · ');

  useEffect(() => {
    if (selection && !selected && !unlocated_open) setSelection(null);
  }, [selection, selected, unlocated_open]);

  function openNearby(category: 'sight' | 'stay', stop: PlannedStop) {
    const from_card = Boolean(panel.current?.contains(document.activeElement));
    const restoreFocus = () => {
      if (workspace.current?.dataset.mapDay !== day) return false;
      const scope = from_card
        ? panel.current
        : workspace.current.querySelector('.map-stop-list-pane');
      return focusNearby(scope, stop.id);
    };
    nearby_return.current = restoreFocus;
    onAddStop(category, stop, restoreFocus);
  }

  // An expanded route list or Undo notice can leave the canvas shorter than its card.
  // In that case the selection uses the main content area, above the notice and tabs.
  useLayoutEffect(() => {
    const canvas = container.current;
    if (!active || !canvas) return;
    const main = canvas.closest<HTMLElement>('.app-content');
    const update = () => {
      const next = canvas.clientHeight < 225 ? main : null;
      if (next === sheet_host) return;
      // Dismissing Undo may already have focused the action inside the old sheet.
      const focused = document.activeElement;
      if (panel.current?.contains(focused) && focused?.matches('.nearby-places-button')) {
        const id = focused.closest<HTMLElement>('[data-map-stop]')?.dataset.mapStop;
        if (id) nearby_return.current = () => focusNearby(panel.current, id);
      }
      setSheetHost(next);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [container, active, sheet_host]);

  useLayoutEffect(() => {
    const restore = nearby_return.current;
    if (!active || !restore) return;
    const frame = requestAnimationFrame(() => {
      if (restore()) nearby_return.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [active, day, sheet_host]);

  const fitPins = useMapFit(
    map,
    active,
    selected && pin ? pin.fit_key : fit_key,
    data.points,
    dayMapPadding,
  );
  const { tile_failures, retryTiles } = useMapTiles(map, platform.native, active);

  useDayRouteLine(map, stops, active && mode === 'stops');

  useEffect(() => {
    if (!map || !active || !selected || unlocated_open || sheet_host) return;
    const frame = requestAnimationFrame(() => {
      const panel_height = Math.min(panel.current?.clientHeight ?? 160, map.getSize().y * 0.45);
      map.panInside(visiblePosition(selected.position, map.getCenter().lng), {
        paddingTopLeft: [32, 100],
        paddingBottomRight: [60, panel_height + 28],
        animate: false,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [map, active, selected, unlocated_open, sheet_host]);

  function chooseMode(next: MapMode) {
    setMode(next);
    closeSelection();
  }

  const selection_card = (selected || unlocated_open) && (
    <section
      className={`map-selection-card${single_stop ? ' single-stop' : ''}${sheet_host ? ' map-selection-sheet' : ''}`}
      hidden={!active}
      ref={panel}
      aria-label={`${mode === 'stops' ? 'Stops' : 'Entries'} ${unlocated_open ? 'without coordinates' : 'at selected map pin'}`}
    >
      <header>
        <div>
          {sheet_host ? (
            <span className="map-sheet-context">
              {labels.label} · <time dateTime={day}>{formatTripDates(day, day)}</time>
            </span>
          ) : (
            !single_stop && (
              <span className="map-card-kicker">
                {unlocated_open
                  ? 'NOT ON THIS MAP'
                  : displayCount(
                      selection_count,
                      selected_stops.length,
                      selected_stays.length,
                    ).toUpperCase()}
              </span>
            )
          )}
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
          {single_stop ? (
            <p className="map-single-detail">{single_detail}</p>
          ) : (
            selected &&
            !sheet_host && (
              <p>
                {formatCoordinates(selected.position)}{' '}
                {(!selected_stops.length || !selected_stays.length) && (
                  <span>· {selected_stays.length ? 'hotel stay' : labels.position_label}</span>
                )}
              </p>
            )
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
      {single_stop ? (
        <div className="map-single-actions" data-map-stop={single_stop.id}>
          <button
            type="button"
            className="map-edit-action"
            aria-label={selected_stays[0]?.label ?? `Edit ${single_stop.title}`}
            onClick={() => onOpenStop(single_stop.id)}
          >
            <Icon name="edit" size={16} />
            Edit {single_stop.kind === 'stay' ? 'stay' : 'stop'}
          </button>
          {single_category && (
            <NearbyPlacesButton
              stop={single_stop}
              category={single_category}
              onAddStop={openNearby}
            />
          )}
        </div>
      ) : (
        <div className="map-selected-visits">
          {selected_stops.map((stop) => (
            <MapStopRow
              key={stop.id}
              stop={stop}
              number={numbers.get(stop.id)!}
              onOpen={onOpenStop}
              nearbyCategory={nearbyCategory}
              onAddStop={openNearby}
            />
          ))}
          {selected_stays.map((stay) => (
            <MapStopRow
              key={stay.stop.id}
              stop={stay.stop}
              stay_label={stay.label}
              onOpen={onOpenStop}
              nearbyCategory={nearbyCategory}
              onAddStop={openNearby}
            />
          ))}
          {selected_visits.map((visit) => {
            const place = visit.place_id === null ? undefined : places_by_id.get(visit.place_id);
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
      )}
    </section>
  );

  return (
    <div className="map-workspace" ref={workspace} data-map-day={day} hidden={!active}>
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
              selected={selected?.key === group.key}
              onSelect={() =>
                setSelection({
                  context,
                  kind: 'pin',
                  key: group.key,
                  entry_ids: group.entry_ids,
                  fit_key,
                })
              }
            />
          ))}
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
            onClick={() => setSelection({ context, kind: 'unlocated' })}
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
        {selection_card && (sheet_host ? createPortal(selection_card, sheet_host) : selection_card)}
      </section>
      <div className="map-route-panel">
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
            key={`${trip.id}/${day}`}
            stops={stops}
            continuing_stays={continuing_stays}
            onOpenStop={onOpenStop}
            nearbyCategory={nearbyCategory}
            onAddStop={openNearby}
            onMoveStop={onMoveStop}
            onReorderStops={onReorderStops}
            onOptimize={onOptimize}
          />
        )}
      </div>
    </div>
  );
}
