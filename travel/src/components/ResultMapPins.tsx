import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Map as LeafletMap } from 'leaflet';
import type { DayPlaceResult } from '../lib/place-comparison';
import { placeTypeLabel } from '../lib/place-types';
import { useMapPinClusters } from '../lib/use-map-pin-clusters';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { PlaceMapButton } from './PlaceMapPins';

const kind_icons = {
  sight: 'landmark',
  stay: 'bed',
  food: 'food',
  transport: 'route',
  other: 'pin',
} as const;

export function ResultMapPins({
  map,
  zoom,
  results,
  selected_id,
  onSelect,
  card_title,
  disabled,
}: {
  map: LeafletMap;
  zoom: number;
  results: readonly DayPlaceResult[];
  selected_id: string;
  onSelect(id: string): void;
  card_title: RefObject<HTMLHeadingElement | null>;
  disabled: boolean;
}) {
  // Anchor the highlighted pin at the selected venue, including when paging through results.
  const pins = useMemo(() => {
    const pins = results.map(({ place }) => ({ key: place.id, position: place.position, place }));
    const index = pins.findIndex(({ key }) => key === selected_id);
    if (index > 0) pins.unshift(...pins.splice(index, 1));
    return pins;
  }, [results, selected_id]);
  const clusters = useMapPinClusters(map, pins, zoom, 44);
  const [chooser_ids, setChooserIds] = useState<ReadonlySet<string> | null>(null);
  const choices = chooser_ids && results.filter(({ place }) => chooser_ids.has(place.id));
  const initial_row = useRef<HTMLButtonElement>(null);
  const return_to = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (chooser_ids) {
      initial_row.current?.focus();
    } else if (return_to.current) {
      return_to.current.focus({ preventScroll: true });
      return_to.current.scrollIntoView({ block: 'nearest' });
      return_to.current = null;
    }
  }, [chooser_ids]);

  return (
    <>
      {clusters.map(({ key, position, groups }) => {
        const { place } = groups[0];
        const counted = groups.length > 1;
        const selected = place.id === selected_id;
        return (
          <PlaceMapButton
            key={key}
            map={map}
            position={position}
            label={
              counted ? `Choose from ${groups.length} map results` : `Show ${place.title} on map`
            }
            description={counted ? groups.map(({ place }) => place.title).join(' · ') : undefined}
            selected={selected}
            opens_dialog={counted}
            disabled={disabled}
            onClick={(button) => {
              map.closePopup();
              if (counted) {
                return_to.current = button;
                setChooserIds(new Set(groups.map(({ key }) => key)));
              } else {
                onSelect(place.id);
              }
            }}
          >
            {counted ? (
              <span className="browse-result-count">
                <Icon name="layers" size={13} />
                {groups.length}
              </span>
            ) : (
              <span className="browse-pin-badge">
                <Icon name={kind_icons[place.kind]} size={18} />
              </span>
            )}
          </PlaceMapButton>
        );
      })}
      {choices &&
        createPortal(
          <Dialog title="Places on map" onDismiss={() => setChooserIds(null)}>
            <div className="map-choice-options">
              {choices.map(({ place, planned, distance_label }, index) => {
                const selected = place.id === selected_id;
                const detail = [
                  place.place_type && placeTypeLabel(place.place_type),
                  place.subtitle,
                  distance_label,
                  planned.length > 0 && 'On this day',
                ]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <button
                    key={place.id}
                    type="button"
                    aria-label={place.title}
                    aria-description={detail || undefined}
                    aria-pressed={selected}
                    ref={
                      selected || (index === 0 && !chooser_ids?.has(selected_id))
                        ? initial_row
                        : undefined
                    }
                    onClick={() => {
                      return_to.current = card_title.current;
                      onSelect(place.id);
                      setChooserIds(null);
                    }}
                  >
                    <span>
                      <strong>{place.title}</strong>
                      {detail && <small>{detail}</small>}
                    </span>
                    {selected && <Icon name="check" size={19} />}
                  </button>
                );
              })}
            </div>
          </Dialog>,
          map.getContainer().closest('.app-shell') ?? document.body,
        )}
    </>
  );
}
