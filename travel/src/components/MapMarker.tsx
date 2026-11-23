import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { divIcon, marker, type Map as LeafletMap, type Marker } from 'leaflet';
import { visiblePosition } from '../lib/map';
import type { Coordinates } from '../lib/types';

/** Leaflet owns positioning across wrapped worlds. React owns the marker's controls. */
export function MapMarker({
  map,
  position,
  anchor_y,
  height = 44,
  z_index,
  children,
}: {
  map: LeafletMap;
  position: Coordinates;
  anchor_y: number;
  height?: number;
  z_index: number;
  children: ReactNode;
}) {
  const [content] = useState(() => document.createElement('div'));
  const pin = useRef<Marker | null>(null);
  const { latitude, longitude } = position;
  useLayoutEffect(() => {
    const coordinate = () => visiblePosition({ latitude, longitude }, map.getCenter().lng);
    const current = marker(coordinate(), {
      interactive: false,
      keyboard: false,
      icon: divIcon({
        html: content,
        className: 'fieldnotes-map-marker',
        iconSize: [44, height],
        iconAnchor: [22, anchor_y],
      }),
    }).addTo(map);
    pin.current = current;
    const wrap = () => current.setLatLng(coordinate());
    map.on('moveend', wrap);
    return () => {
      map.off('moveend', wrap);
      current.remove();
      pin.current = null;
    };
  }, [map, content, latitude, longitude, anchor_y, height]);
  useLayoutEffect(() => {
    pin.current?.setZIndexOffset(z_index);
  }, [map, latitude, longitude, anchor_y, height, z_index]);
  return createPortal(children, content);
}
