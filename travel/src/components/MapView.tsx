import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GridLayer,
  divIcon,
  layerGroup,
  map as createMap,
  marker,
  type Coords,
  type DoneCallback,
  type Map as LeafletMap,
  type Marker,
  type TileEvent,
} from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../map.css';
import { formatVisitDate, formatVisitTime } from '../lib/dates';
import { fitCoordinates, mapPoints, type MapMode, type MapPoint } from '../lib/map';
import { createTileSource } from '../lib/map-tiles';
import { formatCoordinates } from '../lib/model';
import type { CheckIn, Coordinates, Place, TravelPlatform } from '../lib/types';
import { Icon } from './Icon';
import { Photo } from './Photo';

type TileSource = ReturnType<typeof createTileSource>;
type TileState = { controller: AbortController; object_url: string; failed: boolean };
type PinGroup = { key: string; position: Coordinates; points: MapPoint[]; visit_ids: string[] };

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

function normalizeLongitude(longitude: number): number {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

function groupPins(points: MapPoint[]): PinGroup[] {
  const groups = new Map<string, PinGroup>();
  for (const point of points) {
    const key = `${point.position.latitude}/${normalizeLongitude(point.position.longitude)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.points.push(point);
      existing.visit_ids.push(...point.visit_ids);
    } else {
      groups.set(key, {
        key,
        position: point.position,
        points: [point],
        visit_ids: [...point.visit_ids],
      });
    }
  }
  return [...groups.values()];
}

function visiblePosition(position: Coordinates, map: LeafletMap): [number, number] {
  const longitude = normalizeLongitude(position.longitude);
  const wrapped = longitude + 360 * Math.round((map.getCenter().lng - longitude) / 360);
  return [position.latitude, wrapped];
}

function fitPins(map: LeafletMap, points: MapPoint[]) {
  const bounds = fitCoordinates(points);
  if (!bounds) {
    map.setView([20, 0], 2, { animate: false });
    return;
  }
  const clamp = (value: number) => Math.min(85.05112878, Math.max(-85.05112878, value));
  map.fitBounds(
    [
      [clamp(bounds.south), bounds.west],
      [clamp(bounds.north), bounds.east],
    ],
    {
      paddingTopLeft: [42, 112],
      paddingBottomRight: [56, 76],
      maxZoom: 14,
      animate: false,
    },
  );
}

export function MapView({
  visits,
  places,
  platform,
  onOpenVisit,
  active,
}: {
  visits: CheckIn[];
  places: Place[];
  platform: TravelPlatform;
  onOpenVisit(id: string): void;
  active: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const tile_layer = useRef<JournalTiles | null>(null);
  const markers = useRef(new Map<string, Marker>());
  const last_fitted = useRef('');
  const [map, setMap] = useState<LeafletMap | null>(null);
  const [mode, setMode] = useState<MapMode>('visits');
  const [zoom, setZoom] = useState(2);
  const [tile_failures, setTileFailures] = useState(0);
  const [selected_key, setSelectedKey] = useState<string | null>(null);
  const [unlocated_open, setUnlocatedOpen] = useState(false);
  const data = useMemo(() => mapPoints(visits, places, mode), [visits, places, mode]);
  const groups = useMemo(() => groupPins(data.points), [data.points]);
  const fit_key = `${mode}:${groups.map((group) => group.key).join(';')}`;
  const selected = groups.find((group) => group.key === selected_key);
  const visible_ids = new Set(
    unlocated_open ? data.unlocated_visit_ids : (selected?.visit_ids ?? []),
  );
  const selected_visits = visits
    .filter((visit) => visible_ids.has(visit.id))
    .sort((a, b) => b.visited_at.localeCompare(a.visited_at));
  const places_by_id = new Map(places.map((place) => [place.id, place]));
  const mapped_visits = visits.length - data.unlocated_visit_ids.length;
  const selected_names = selected ? [...new Set(selected.points.map((point) => point.label))] : [];

  useEffect(() => {
    setSelectedKey(null);
    setUnlocatedOpen(false);
  }, [visits]);

  useEffect(() => {
    if (!container.current) return;
    const instance = createMap(container.current, {
      zoomControl: false,
      attributionControl: true,
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
    const resize =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (container.current?.clientWidth && container.current.clientHeight)
              instance.invalidateSize({ pan: false });
          });
    resize?.observe(container.current);
    setMap(instance);
    return () => {
      resize?.disconnect();
      instance.remove();
    };
  }, []);

  // Fit before attaching tiles, so opening the map only downloads its actual viewport.
  useEffect(() => {
    if (!map || !active) return;
    map.invalidateSize({ pan: false });
    if (last_fitted.current !== fit_key) {
      last_fitted.current = fit_key;
      fitPins(map, data.points);
    }
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
    if (!map) return;
    const pins = layerGroup().addTo(map);
    const next_markers = new Map<string, Marker>();
    for (const group of groups) {
      const content = document.createElement('span');
      content.className = 'map-pin-bubble';
      const count = document.createElement('span');
      count.textContent = String(group.visit_ids.length);
      content.append(count);
      const names = [...new Set(group.points.map((point) => point.label))].join(', ');
      const label = `${names}: ${group.visit_ids.length} ${group.visit_ids.length === 1 ? 'check-in' : 'check-ins'}`;
      const pin = marker(visiblePosition(group.position, map), {
        icon: divIcon({
          className: `journal-map-pin ${mode}`,
          html: content,
          iconSize: [44, 48],
          iconAnchor: [22, 43],
        }),
        title: label,
        keyboard: true,
        riseOnHover: true,
      }).addTo(pins);
      const element = pin.getElement();
      element?.setAttribute('aria-label', label);
      element?.setAttribute('data-latitude', String(group.position.latitude));
      element?.setAttribute('data-longitude', String(group.position.longitude));
      element?.setAttribute('data-visit-count', String(group.visit_ids.length));
      pin.on('click', () => {
        setSelectedKey(group.key);
        setUnlocatedOpen(false);
      });
      next_markers.set(group.key, pin);
    }
    markers.current = next_markers;
    const wrapPins = () => {
      for (const group of groups)
        next_markers.get(group.key)?.setLatLng(visiblePosition(group.position, map));
    };
    map.on('moveend', wrapPins);
    return () => {
      map.off('moveend', wrapPins);
      pins.remove();
      next_markers.clear();
    };
  }, [map, groups, mode]);

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
      map.panInside(visiblePosition(selected.position, map), {
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
    <section className="map-view" hidden={!active} aria-label="Travel map">
      <div
        className="journal-map-canvas"
        ref={container}
        role="region"
        aria-label={
          mode === 'visits'
            ? 'Map of actual visit locations'
            : 'Map of named place reference locations'
        }
      />
      <div className="map-top-tools">
        <div className="map-mode-switch" role="group" aria-label="Map positions">
          <button
            type="button"
            aria-pressed={mode === 'visits'}
            onClick={() => chooseMode('visits')}
          >
            <Icon name="locate" size={16} />
            Actual visits
          </button>
          <button
            type="button"
            aria-pressed={mode === 'places'}
            onClick={() => chooseMode('places')}
          >
            <Icon name="pin" size={16} />
            Named places
          </button>
        </div>
        <button
          type="button"
          className="map-square-control"
          aria-label="Fit all map pins"
          title="Fit all pins"
          onClick={() => {
            if (map) fitPins(map, data.points);
          }}
        >
          <Icon name="compass" size={20} />
        </button>
      </div>
      <div className="map-caption">
        <span className={`map-legend-dot ${mode}`} />
        <span>
          {mode === 'visits' ? 'Where your visits happened' : 'Standard positions of named places'}
          <small>
            {mapped_visits} of {visits.length} check-ins on the map
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
          <strong>
            {visits.length
              ? 'These moments need a position.'
              : 'Your journeys will take shape here.'}
          </strong>
          <span>
            {visits.length
              ? mode === 'visits'
                ? 'Add actual visit coordinates to see your check-ins here.'
                : 'Add reference coordinates to your named places to see them here.'
              : 'Check in on a trip to put a memory on the map.'}
          </span>
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
      {data.unlocated_visit_ids.length > 0 && !selected && !unlocated_open && (
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
            {data.unlocated_visit_ids.length}{' '}
            {mode === 'visits' ? 'without visit coordinates' : 'without place coordinates'}
          </span>
          <Icon name="arrow" size={15} />
        </button>
      )}
      {(selected || unlocated_open) && (
        <section
          className="map-selection-card"
          ref={panel}
          aria-label={
            unlocated_open ? 'Check-ins without coordinates' : 'Check-ins at selected map pin'
          }
        >
          <header>
            <div>
              <span className="map-card-kicker">
                {unlocated_open
                  ? 'NOT ON THIS MAP'
                  : `${selected_visits.length} ${selected_visits.length === 1 ? 'CHECK-IN' : 'CHECK-INS'}`}
              </span>
              <h2>
                {unlocated_open
                  ? 'Missing coordinates'
                  : selected_names.length === 1
                    ? selected_names[0]
                    : 'Moments at this position'}
              </h2>
              {selected && (
                <p>
                  {formatCoordinates(selected.position)}{' '}
                  <span>· {mode === 'visits' ? 'actual visit' : 'place reference'}</span>
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
            {selected_visits.map((visit) => {
              const place = places_by_id.get(visit.place_id)!;
              return (
                <article className="map-visit-row" key={visit.id}>
                  {visit.photos[0] ? (
                    <div className="map-visit-photo">
                      <Photo photo={visit.photos[0]} platform={platform} alt={place.name} />
                    </div>
                  ) : (
                    <span className="map-visit-symbol">
                      <Icon name="pin" size={22} />
                    </span>
                  )}
                  <div className="map-visit-copy">
                    <h3>{place.name}</h3>
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
                      View check-in
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
  );
}
