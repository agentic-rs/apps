import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GridLayer,
  divIcon,
  layerGroup,
  map as createMap,
  marker,
  polyline,
  type Coords,
  type DoneCallback,
  type Map as LeafletMap,
  type Marker,
  type TileEvent,
} from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../map.css';
import { formatVisitDate, formatVisitTime } from '../lib/dates';
import {
  fitCoordinates,
  mapPoints,
  mapStops,
  normalizeLongitude,
  routeLines,
  visiblePosition,
  type MapMode,
  type MapPoint,
} from '../lib/map';
import { createTileSource } from '../lib/map-tiles';
import { formatCoordinates, formatEntryCount, visitTitle } from '../lib/model';
import {
  type CheckIn,
  type Coordinates,
  type Place,
  type PlannedStop,
  type TravelPlatform,
} from '../lib/types';
import { Icon } from './Icon';
import { Photo } from './Photo';
import { MapStopButton, MapStopList } from './MapStopList';
import type { MoveStop } from './StopOrderButtons';

type TileSource = ReturnType<typeof createTileSource>;
type TileState = { controller: AbortController; object_url: string; failed: boolean };
type PinGroup = { key: string; position: Coordinates; points: MapPoint[]; entry_ids: string[] };

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

/** Native tiles use the host HTTP bridge; images only see private blob URLs. */
class JournalTiles extends GridLayer {
  private readonly tiles = new Map<HTMLImageElement, TileState>();

  constructor(
    private readonly source: TileSource,
    private readonly reportFailures: (count: number) => void,
  ) {
    super({
      tileSize: 256,
      minZoom: 2,
      maxZoom: 19,
      updateWhenIdle: true,
      updateWhenZooming: false,
      keepBuffer: 0,
      bounds: [
        [-85.05112878, -180],
        [85.05112878, 180],
      ],
    });
    this.on('tileunload', (event: TileEvent) => this.release(event.tile as HTMLImageElement));
  }

  createTile(coords: Coords, done: DoneCallback): HTMLElement {
    const image = document.createElement('img');
    image.alt = '';
    image.setAttribute('role', 'presentation');
    image.decoding = 'async';
    const state = { controller: new AbortController(), object_url: '', failed: false };
    this.tiles.set(image, state);

    const fail = (reason: unknown) => {
      if (!this.tiles.has(image) || state.controller.signal.aborted) return;
      state.failed = true;
      image.style.opacity = '0';
      this.report();
      done(reason instanceof Error ? reason : new Error('Map tile unavailable.'), image);
    };
    image.onload = () => {
      if (!this.tiles.has(image)) return;
      done(undefined, image);
      this.report();
    };
    image.onerror = () => fail(new Error('The map tile could not be displayed.'));
    this.source
      .readTile({ z: coords.z, x: coords.x, y: coords.y }, state.controller.signal)
      .then((blob) => {
        if (!this.tiles.has(image) || state.controller.signal.aborted) return;
        state.object_url = URL.createObjectURL(blob);
        image.src = state.object_url;
      })
      .catch(fail);
    return image;
  }

  private report() {
    this.reportFailures([...this.tiles.values()].filter((tile) => tile.failed).length);
  }

  private release(image: HTMLImageElement) {
    const state = this.tiles.get(image);
    if (!state) return;
    this.tiles.delete(image);
    state.controller.abort();
    image.onload = null;
    image.onerror = null;
    image.removeAttribute('src');
    if (state.object_url) URL.revokeObjectURL(state.object_url);
    this.report();
  }

  dispose() {
    for (const image of this.tiles.keys()) this.release(image);
  }
}

function groupPins(points: MapPoint[]): PinGroup[] {
  const groups = new Map<string, PinGroup>();
  for (const point of points) {
    const key = `${point.position.latitude}/${normalizeLongitude(point.position.longitude)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.points.push(point);
      existing.entry_ids.push(...point.entry_ids);
    } else {
      groups.set(key, {
        key,
        position: point.position,
        points: [point],
        entry_ids: [...point.entry_ids],
      });
    }
  }
  return [...groups.values()];
}

function fitPins(map: LeafletMap, points: MapPoint[]) {
  map.invalidateSize();
  const bounds = fitCoordinates(points);
  if (!bounds) {
    map.setView([20, 0], 2, { animate: false });
    return;
  }
  const height = map.getSize().y;
  // Leave room for the right-hand zoom buttons and the full pin bubbles. The
  // caption is hidden on short maps, so more of that height can show the route.
  const top = Math.min(height <= 360 ? 106 : 156, Math.floor(height * 0.45));
  const clamp = (value: number) => Math.min(85.05112878, Math.max(-85.05112878, value));
  map.fitBounds(
    [
      [clamp(bounds.south), bounds.west],
      [clamp(bounds.north), bounds.east],
    ],
    {
      paddingTopLeft: [32, top],
      paddingBottomRight: [82, Math.min(90, Math.floor(height * 0.25))],
      maxZoom: 14,
      animate: false,
    },
  );
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
  const container = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const tile_layer = useRef<JournalTiles | null>(null);
  const markers = useRef(new Map<string, Marker>());
  const last_fitted = useRef('');
  const following_pins = useRef(true);
  const [map, setMap] = useState<LeafletMap | null>(null);
  const [mode, setMode] = useState<MapMode>('stops');
  const [zoom, setZoom] = useState(2);
  const [tile_failures, setTileFailures] = useState(0);
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

  useEffect(() => {
    if (!container.current) return;
    const instance = createMap(container.current, {
      zoomControl: false,
      attributionControl: true,
      trackResize: false,
      minZoom: 2,
      maxZoom: 19,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
    }).setView([20, 0], 2);
    instance.attributionControl.setPrefix(false);
    instance.attributionControl.addAttribution(
      '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    );
    const updateZoom = () => setZoom(instance.getZoom());
    instance.on('zoomend', updateZoom);
    setMap(instance);
    return () => {
      instance.remove();
    };
  }, []);

  // Fit before attaching tiles, so opening the map only downloads its actual viewport.
  useEffect(() => {
    if (!map || !active) return;
    const markMoved = () => {
      following_pins.current = false;
    };
    map.on('movestart zoomstart', markMoved);
    const refit = () => {
      fitPins(map, data.points);
      following_pins.current = true;
      last_fitted.current = fit_key;
    };
    if (last_fitted.current !== fit_key) refit();
    const element = map.getContainer();
    const updateSize = () => {
      const previous = map.getSize();
      if (
        !element.clientHeight ||
        !element.clientWidth ||
        (element.clientWidth === previous.x && element.clientHeight === previous.y)
      )
        return;
      if (following_pins.current) refit();
      else map.invalidateSize();
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateSize);
    if (observer) observer.observe(element);
    else window.addEventListener('resize', updateSize);
    return () => {
      map.off('movestart zoomstart', markMoved);
      observer?.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, [map, active, fit_key, data.points]);

  useEffect(() => {
    if (!map || !active) return;
    let live = true;
    setTileFailures(0);
    const source = createTileSource(platform.native);
    const tiles = new JournalTiles(source, (count) => {
      if (live) setTileFailures(count);
    });
    tile_layer.current = tiles;
    tiles.addTo(map);
    return () => {
      live = false;
      tile_layer.current = null;
      tiles.remove();
      tiles.dispose();
      source.dispose();
    };
  }, [map, active, platform.native]);

  useEffect(() => {
    if (!map || !active || mode !== 'stops' || stops.length < 2) return;
    const path = polyline(routeLines(stops, map.getCenter().lng), {
      className: 'map-route-line',
      interactive: false,
      weight: 3,
      opacity: 0.92,
      dashArray: '6 7',
    }).addTo(map);
    const wrapRoute = () => path.setLatLngs(routeLines(stops, map.getCenter().lng));
    map.on('moveend', wrapRoute);
    return () => {
      map.off('moveend', wrapRoute);
      path.remove();
    };
  }, [map, active, mode, stops]);

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
            onClick={() => {
              if (map) {
                fitPins(map, data.points);
                following_pins.current = true;
              }
            }}
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
            <button type="button" onClick={() => tile_layer.current?.redraw()}>
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
                <button type="button" onClick={() => tile_layer.current?.redraw()}>
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
                onClick={() => {
                  setSelectedKey(null);
                  setUnlocatedOpen(false);
                }}
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
