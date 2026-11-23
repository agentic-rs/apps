import { useCallback, useEffect, useRef, useState } from 'react';
import {
  GridLayer,
  map as createMap,
  polyline,
  type Coords,
  type DoneCallback,
  type Map as LeafletMap,
  type TileEvent,
  type FitBoundsOptions,
  type Point,
} from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { createTileSource, type MapTileSource } from './map-tiles';
import { fitCoordinates, routeLines } from './map';
import type { Coordinates, PlannedStop } from './types';

type TileState = { controller: AbortController; object_url: string; failed: boolean };
/** Native tiles use the host HTTP bridge; images only see private blob URLs. */
class JournalTiles extends GridLayer {
  private readonly tiles = new Map<HTMLImageElement, TileState>();

  constructor(
    private readonly source: MapTileSource,
    private readonly reportFailures: (count: number) => void,
  ) {
    super({
      tileSize: 256,
      minZoom: 0,
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

export function useLeafletMap(min_zoom: number = 2) {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<LeafletMap | null>(null);
  const [zoom, setZoom] = useState(2);
  useEffect(() => {
    if (!container.current) return;
    const instance = createMap(container.current, {
      zoomControl: false,
      attributionControl: true,
      trackResize: false,
      minZoom: min_zoom,
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
  }, [min_zoom]);

  return { container, map, zoom };
}

export function useMapTiles(map: LeafletMap | null, native: boolean, active: boolean) {
  const tile_layer = useRef<JournalTiles | null>(null);
  const [tile_failures, setTileFailures] = useState(0);
  useEffect(() => {
    if (!map || !active) return;
    let live = true;
    setTileFailures(0);
    const source = createTileSource(native);
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
  }, [map, active, native]);

  return { tile_failures, retryTiles: () => tile_layer.current?.redraw() };
}

export function useDayRouteLine(
  map: LeafletMap | null,
  stops: readonly Pick<PlannedStop, 'position'>[],
  active: boolean,
) {
  useEffect(() => {
    if (!map || !active || stops.length < 2) return;
    const path = polyline(routeLines(stops, map.getCenter().lng), {
      className: 'map-route-line',
      color: 'var(--apell-primary)',
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
  }, [map, active, stops]);
}

export function fitMapPoints(
  map: LeafletMap,
  points: readonly { position: Coordinates }[],
  padding: MapPadding,
) {
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
      ...padding,
      maxZoom: 14,
      animate: false,
    },
  );
}

export type MapPadding = Pick<FitBoundsOptions, 'paddingTopLeft' | 'paddingBottomRight'>;

/** Run before attaching tiles so the first requests match the actual viewport. */
export function useMapFit(
  map: LeafletMap | null,
  active: boolean,
  fit_key: string,
  points: readonly { position: Coordinates }[],
  padding: (size: Point) => MapPadding,
) {
  const last_fitted = useRef('');
  const following_pins = useRef(true);
  const refit = useCallback(() => {
    if (!map) return;
    map.invalidateSize();
    fitMapPoints(map, points, padding(map.getSize()));
    following_pins.current = true;
    last_fitted.current = fit_key;
  }, [map, points, padding, fit_key]);
  useEffect(() => {
    if (!map || !active) return;
    const markMoved = () => {
      following_pins.current = false;
    };
    map.on('movestart zoomstart', markMoved);
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
  }, [map, active, fit_key, refit]);

  return refit;
}
