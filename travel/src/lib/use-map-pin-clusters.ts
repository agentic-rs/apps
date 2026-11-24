import { useLayoutEffect, useMemo, useState } from 'react';
import type { Map as LeafletMap } from 'leaflet';
import { visiblePosition } from './map';
import { clusterMapPins } from './map-pin-clusters';
import type { Coordinates } from './types';

export function useMapPinClusters<T extends { key: string; position: Coordinates }>(
  map: LeafletMap | null,
  groups: readonly T[],
  zoom: number,
  pin_height = 48,
) {
  const [center_longitude, setCenterLongitude] = useState(0);
  useLayoutEffect(() => {
    if (!map) return;
    const update = () => setCenterLongitude(map.getCenter().lng);
    update();
    map.on('moveend', update);
    return () => {
      map.off('moveend', update);
    };
  }, [map]);
  return useMemo(
    () =>
      map
        ? clusterMapPins(
            groups,
            (position) => map.project(visiblePosition(position, center_longitude), zoom).round(),
            pin_height,
          )
        : [],
    [map, groups, center_longitude, zoom, pin_height],
  );
}
