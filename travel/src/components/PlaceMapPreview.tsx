import { useEffect, useMemo } from 'react';
import { divIcon, layerGroup, marker, type Marker } from 'leaflet';
import { formatDistance } from '../lib/distance';
import { useLeafletMap, useMapFit, useMapTiles, type MapPadding } from '../lib/leaflet-map';
import { normalizeLongitude, previewDayStops, visiblePosition } from '../lib/map';
import type { Coordinates, PlannedStop } from '../lib/types';
import { Icon } from './Icon';
import '../place-map-preview.css';

const previewPadding = (): MapPadding => ({
  paddingTopLeft: [36, 52],
  paddingBottomRight: [36, 70],
});

export default function PlaceMapPreview({
  title,
  position,
  stops,
  native,
  context,
  editing_id,
}: {
  title: string;
  position: Coordinates;
  stops: PlannedStop[];
  native: boolean;
  context?: string;
  editing_id?: string;
}) {
  const { container, map, zoom } = useLeafletMap(0);
  const { groups, numbers, closest, other_count } = useMemo(
    () => previewDayStops(position, stops, editing_id),
    [position, stops, editing_id],
  );
  const points = useMemo(() => [{ position }, ...groups], [position, groups]);
  const candidate_key = `${position.latitude}/${normalizeLongitude(position.longitude)}`;
  const fit_key = [candidate_key, ...groups.map((group) => group.key)].join(';');
  const fitPins = useMapFit(map, true, fit_key, points, previewPadding);
  const { tile_failures, retryTiles } = useMapTiles(map, native, true);
  const name = title.trim() || 'Selected place';

  useEffect(() => {
    if (!map) return;
    const pins = layerGroup().addTo(map);
    const center_longitude = map.getCenter().lng;
    const anchored: { pin: Marker; position: Coordinates }[] = [];
    function addPin(
      location: Coordinates,
      labels: string[],
      content: HTMLElement,
      class_name: string,
      anchor_y: number,
      z_index: number,
    ) {
      const label = labels.join(' · ');
      const pin = marker(visiblePosition(location, center_longitude), {
        icon: divIcon({
          html: content,
          className: `place-preview-pin ${class_name}`,
          iconSize: [44, 44],
          iconAnchor: [22, anchor_y],
          popupAnchor: [0, -anchor_y],
        }),
        title: label,
        zIndexOffset: z_index,
      }).addTo(pins);
      const popup = document.createElement('div');
      for (const text of labels) {
        const line = document.createElement('div');
        line.textContent = text;
        popup.append(line);
      }
      pin.bindPopup(popup, { maxWidth: 220 });
      anchored.push({ pin, position: location });
      const element = pin.getElement()!;
      element.setAttribute('aria-label', label);
      return element;
    }

    for (const group of groups) {
      const sequence = group.points.map((point) => numbers.get(point.id)!);
      const labels = group.points.map((point, index) => `Stop ${sequence[index]}, ${point.label}`);
      const badge = document.createElement('span');
      badge.className = 'place-stop-badge';
      badge.textContent = String(sequence[0]);
      if (sequence.length > 1) {
        const extra = document.createElement('small');
        extra.textContent = `+${sequence.length - 1}`;
        badge.append(extra);
      }
      // At a shared coordinate the numbered marker sits directly below the candidate's tip.
      const element = addPin(
        group.position,
        labels,
        badge,
        'day-stop',
        group.key === candidate_key ? 0 : 22,
        0,
      );
      element.dataset.stopNumbers = sequence.join(',');
    }
    const tip = document.createElement('span');
    tip.className = 'place-candidate-tip';
    const candidate = addPin(position, [`Selected place, ${name}`], tip, 'candidate', 44, 1000);
    candidate.dataset.candidatePin = '';

    const wrapPins = () => {
      for (const entry of anchored)
        entry.pin.setLatLng(visiblePosition(entry.position, map.getCenter().lng));
    };
    map.on('moveend', wrapPins);
    return () => {
      map.off('moveend', wrapPins);
      pins.remove();
    };
  }, [map, groups, numbers, candidate_key, position, name]);

  return (
    <section className="place-map-preview">
      <header className="place-map-detail">
        {context && <span className="place-map-context">{context}</span>}
        <div className="place-map-title">
          <Icon name="pin" size={22} />
          <h3>{name}</h3>
        </div>
        {closest ? (
          <p>
            Closest stop{' '}
            <strong>
              {closest.number} · {closest.title}
            </strong>
            <span>{formatDistance(closest.km)} straight-line distance</span>
          </p>
        ) : (
          <p>
            {other_count
              ? 'The other stops on this day have no map coordinates.'
              : 'No other stops on this day.'}
          </p>
        )}
      </header>
      <div
        ref={container}
        className="place-map-canvas"
        role="region"
        aria-label="Map of selected place and day stops"
      />
      {tile_failures > 0 && (
        <div className="place-map-status" role="status">
          Map background unavailable.
          <button type="button" onClick={retryTiles}>
            Retry
          </button>
        </div>
      )}
      <div className="place-map-controls" role="group" aria-label="Map controls">
        <button
          type="button"
          onClick={() => {
            map?.closePopup();
            fitPins();
          }}
          aria-label="Fit all map pins"
        >
          <Icon name="map" /> Fit all
        </button>
        <button
          type="button"
          aria-label="Center on selected place"
          title="Center on selected place"
          onClick={() => {
            map?.closePopup();
            map?.setView(
              visiblePosition(position, map.getCenter().lng),
              Math.max(14, map.getZoom()),
              { animate: false },
            );
          }}
        >
          <Icon name="locate" />
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          disabled={zoom <= 0}
          onClick={() => map?.zoomOut()}
        >
          <span aria-hidden="true">−</span>
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          disabled={zoom >= 19}
          onClick={() => map?.zoomIn()}
        >
          <Icon name="plus" />
        </button>
      </div>
    </section>
  );
}
