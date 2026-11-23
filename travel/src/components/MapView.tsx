import { useEffect, useMemo, useRef, useState } from 'react';
import { divIcon, layerGroup, marker, type Point, type Marker } from 'leaflet';
import { formatVisitDate, formatVisitTime } from '../lib/dates';
import { groupPins, mapPoints, mapStops, visiblePosition, type MapMode } from '../lib/map';
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
import { MapStopButton, MapStopList } from './MapStopList';
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

export default function MapView({
  stops,
  visits,
  places,
  platform,
  onOpenVisit,
  onOpenStop,
  onMoveStop,
  onOptimize,
  active,
}: {
  stops: PlannedStop[];
  visits: CheckIn[];
  places: Place[];
  platform: TravelPlatform;
  onOpenVisit(id: string): void;
  onOpenStop(id: string): void;
  onMoveStop: MoveStop;
  onOptimize(): void;
  active: boolean;
}) {
  const { container, map, zoom } = useLeafletMap();
  const panel = useRef<HTMLElement>(null);
  const markers = useRef(new Map<string, Marker>());
  const [mode, setMode] = useState<MapMode>('stops');
  const [selected_key, setSelectedKey] = useState<string | null>(null);
  const [unlocated_open, setUnlocatedOpen] = useState(false);
  const data = useMemo(
    () => (mode === 'stops' ? mapStops(stops) : mapPoints(visits, places, mode)),
    [stops, visits, places, mode],
  );
  const groups = useMemo(() => groupPins(data.points), [data.points]);
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
  const total = mode === 'stops' ? stops.length : visits.length;
  const selection_count = selected_stops.length + selected_visits.length;
  const displayCount = (count: number) =>
    mode === 'stops' ? `${count} ${count === 1 ? 'stop' : 'stops'}` : formatEntryCount(count);
  const labels = map_modes[mode];
  const selected_names = selected ? [...new Set(selected.points.map((point) => point.label))] : [];

  useEffect(() => {
    setSelectedKey(null);
    setUnlocatedOpen(false);
  }, [stops, visits]);

  const fitPins = useMapFit(map, active, fit_key, data.points, dayMapPadding);
  const { tile_failures, retryTiles } = useMapTiles(map, platform.native, active);

  useDayRouteLine(map, stops, active && mode === 'stops');

  useEffect(() => {
    if (!map) return;
    const pins = layerGroup().addTo(map);
    const next_markers = new Map<string, Marker>();
    for (const group of groups) {
      const content = document.createElement('span');
      content.className = 'map-pin-bubble';
      const count = document.createElement('span');
      const planned = mode === 'stops';
      count.textContent = String(
        planned ? numbers.get(group.entry_ids[0]) : group.entry_ids.length,
      );
      content.append(count);
      if (planned && group.entry_ids.length > 1) {
        const extra = document.createElement('small');
        extra.className = 'map-pin-extra';
        extra.textContent = `+${group.entry_ids.length - 1}`;
        content.append(extra);
      }
      const names = [...new Set(group.points.map((point) => point.label))].join(', ');
      const label = planned
        ? group.points.map((point) => `Stop ${numbers.get(point.id)}, ${point.label}`).join(' · ')
        : `${names}: ${formatEntryCount(group.entry_ids.length)}`;
      const pin = marker(visiblePosition(group.position, map.getCenter().lng), {
        icon: divIcon({
          className: `journal-map-pin ${mode}`,
          html: content,
          iconSize: [44, 48],
          iconAnchor: planned ? [22, 21] : [22, 43],
        }),
        title: label,
        keyboard: true,
        riseOnHover: true,
      }).addTo(pins);
      const element = pin.getElement();
      element?.setAttribute('aria-label', label);
      element?.setAttribute('data-latitude', String(group.position.latitude));
      element?.setAttribute('data-longitude', String(group.position.longitude));
      if (planned) {
        element?.setAttribute(
          'data-stop-numbers',
          group.entry_ids.map((id) => numbers.get(id)).join(','),
        );
      } else {
        element?.setAttribute('data-visit-count', String(group.entry_ids.length));
      }
      pin.on('click', () => {
        setSelectedKey(group.key);
        setUnlocatedOpen(false);
      });
      next_markers.set(group.key, pin);
    }
    markers.current = next_markers;
    const wrapPins = () => {
      for (const group of groups)
        next_markers
          .get(group.key)
          ?.setLatLng(visiblePosition(group.position, map.getCenter().lng));
    };
    map.on('moveend', wrapPins);
    return () => {
      map.off('moveend', wrapPins);
      pins.remove();
      next_markers.clear();
    };
  }, [map, groups, mode, numbers]);

  useEffect(() => {
    for (const [key, pin] of markers.current) {
      pin.getElement()?.classList.toggle('selected', key === selected_key && !unlocated_open);
      pin
        .getElement()
        ?.setAttribute('aria-pressed', String(key === selected_key && !unlocated_open));
    }
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
            {labels.description}
            <small>
              {total - data.unlocated_ids.length} of {displayCount(total)} on the map
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
        {tile_failures > 0 && data.points.length > 0 && !selected && !unlocated_open && (
          <div className="map-tile-status" role="status">
            <span>Map background unavailable. Your pins still work.</span>
            <button type="button" onClick={retryTiles}>
              Retry
            </button>
          </div>
        )}
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
              {data.unlocated_ids.length} {labels.missing}
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
                  {unlocated_open ? 'NOT ON THIS MAP' : displayCount(selection_count).toUpperCase()}
                </span>
                <h2>
                  {unlocated_open
                    ? 'Missing coordinates'
                    : selected_names.length === 1
                      ? selected_names[0]
                      : mode === 'stops'
                        ? 'Stops at this position'
                        : 'Moments at this position'}
                </h2>
                {selected && (
                  <p>
                    {formatCoordinates(selected.position)} <span>· {labels.position_label}</span>
                  </p>
                )}
                {tile_failures > 0 && <p role="status">Map background unavailable.</p>}
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
      {mode === 'stops' && stops.length > 0 && (
        <MapStopList
          key={stops[0].day}
          stops={stops}
          onOpenStop={onOpenStop}
          onMoveStop={onMoveStop}
          onOptimize={onOptimize}
        />
      )}
    </div>
  );
}
