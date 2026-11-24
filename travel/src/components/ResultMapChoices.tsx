import { useLayoutEffect, useRef } from 'react';
import type { DayPlaceResult } from '../lib/place-comparison';
import type { MapPoint } from '../lib/map';
import { placeTypeLabel } from '../lib/place-types';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

export interface RouteMapChoice {
  point: MapPoint;
  label: string;
  number?: number;
  origin?: string;
}
export function ResultMapChoices({
  section,
  focus_id,
  selected_id,
  result_choices,
  route_choices,
  onSectionChange,
  onPick,
  onInspect,
  onClose,
}: {
  section: 'result' | 'route';
  focus_id?: string;
  selected_id: string;
  result_choices: readonly DayPlaceResult[];
  route_choices: readonly RouteMapChoice[];
  onSectionChange(section: 'result' | 'route'): void;
  onPick(id: string): void;
  onInspect(choice: RouteMapChoice): void;
  onClose(): void;
}) {
  const initial_row = useRef<HTMLButtonElement>(null);
  const mixed = result_choices.length > 0 && route_choices.length > 0;
  useLayoutEffect(() => {
    initial_row.current?.focus();
  }, [section, focus_id]);
  return (
    <Dialog title="Places on map" onDismiss={onClose}>
      <div className="map-choice-options result-map-choices">
        {mixed && (
          <div className="result-map-segments" role="group" aria-label="Map place types">
            {(['result', 'route'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                aria-label={tab === 'result' ? 'Show search results' : 'Show day route'}
                aria-pressed={section === tab}
                onClick={(event) => {
                  event.currentTarget.focus({ preventScroll: true });
                  onSectionChange(tab);
                }}
              >
                {tab === 'result'
                  ? `Results (${result_choices.length})`
                  : `Day route (${route_choices.length})`}
              </button>
            ))}
          </div>
        )}
        <div className="result-map-panels">
          {result_choices.length > 0 && (
            <div
              className="result-map-choice-list"
              role="group"
              aria-label="Search results"
              aria-hidden={section !== 'result'}
              inert={section !== 'result'}
            >
              {result_choices.map(({ place, planned, distance_label }) => {
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
                    ref={section === 'result' && focus_id === place.id ? initial_row : undefined}
                    onClick={() => onPick(place.id)}
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
          )}
          {route_choices.length > 0 && (
            <div
              className="result-map-choice-list"
              role="group"
              aria-label="Day route"
              aria-hidden={section !== 'route'}
              inert={section !== 'route'}
            >
              {route_choices.map((choice) => (
                <button
                  key={choice.point.id}
                  type="button"
                  aria-label={choice.label}
                  aria-description={choice.origin}
                  ref={
                    section === 'route' && focus_id === choice.point.id ? initial_row : undefined
                  }
                  onClick={() => onInspect(choice)}
                >
                  <span>
                    <strong>{choice.label}</strong>
                    {choice.origin && <small>{choice.origin}</small>}
                  </span>
                  <Icon name="pin" size={17} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
