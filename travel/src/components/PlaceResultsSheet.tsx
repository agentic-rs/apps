import { lazy, Suspense, useRef, useState, type ReactNode } from 'react';
import { formatDistance } from '../lib/distance';
import type { ContinuingStay } from '../lib/hotel-stays';
import { nearestDayPlace } from '../lib/map';
import { matchesPlannedPlace } from '../lib/planned-stop-search';
import { placeTypeLabel } from '../lib/place-types';
import type { StopSearchResult } from '../lib/stop-lookup';
import type { PlannedStop } from '../lib/types';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { SavedPlaceActions } from './StopPlaceResult';
import '../place-results-sheet.css';

const PlaceResultsMap = lazy(() => import('./PlaceResultsMap'));

interface PlaceResultsSheetProps {
  active: boolean;
  native: boolean;
  heading: string;
  day_label: string;
  route: PlannedStop[];
  stays: ContinuingStay[];
  day_stops: PlannedStop[];
  cities: ReactNode;
  type_control: ReactNode;
  places: StopSearchResult[];
  search_status: string;
  search_error: string;
  onRetry(): void;
  saved_message: string;
  saved_stop_id?: string;
  saving: boolean;
  save_error?: { id: string; message: string };
  onPick(place: StopSearchResult, origin: HTMLElement): void;
  onQuickAdd?(place: StopSearchResult, row: HTMLElement, button: HTMLElement): void;
  onScheduleStay?(place: StopSearchResult, origin: HTMLElement): void;
  onEditPlanned?(stop: PlannedStop): void;
  onClose(): void;
}

export function PlaceResultsSheet({
  active,
  native,
  heading,
  route,
  stays,
  day_label,
  day_stops,
  cities,
  type_control,
  places,
  search_status,
  search_error,
  onRetry,
  saved_message,
  saved_stop_id,
  saving,
  save_error,
  onPick,
  onQuickAdd,
  onScheduleStay,
  onEditPlanned,
  onClose,
}: PlaceResultsSheetProps) {
  const [selection, setSelection] = useState('');
  const index = Math.max(
    0,
    places.findIndex((place) => place.id === selection),
  );
  const place = places[index];
  const planned = place ? day_stops.filter((stop) => matchesPlannedPlace(stop, place)) : [];
  const closest =
    place && !planned.length ? nearestDayPlace(place.position, route, stays) : undefined;
  const card_title = useRef<HTMLHeadingElement>(null);
  return (
    <Dialog
      title={heading}
      active={active}
      full_screen
      back_label="Back to place list"
      trailing_action={type_control}
      onDismiss={onClose}
      dismiss_disabled={saving}
    >
      <div className="result-map-sheet">
        <fieldset disabled={saving} className="result-map-city-bar">
          {cities}
          {day_label && <span className="result-map-day">{day_label}</span>}
        </fieldset>
        {place ? (
          <>
            <Suspense
              fallback={
                <p className="result-map-loading" role="status">
                  Opening map…
                </p>
              }
            >
              <PlaceResultsMap
                places={places}
                stops={route}
                stays={stays}
                selected_id={place.id}
                onSelect={(id) => {
                  if (!saving) setSelection(id);
                }}
                native={native}
                active={active}
              />
            </Suspense>
            <fieldset
              className="result-map-card"
              role="group"
              aria-label="Selected place"
              disabled={saving}
            >
              <div className="result-map-card-heading">
                <div aria-live="polite" aria-atomic="true">
                  <span className="result-map-count">
                    {index + 1} of {places.length}
                  </span>
                  <h3 ref={card_title} tabIndex={-1}>
                    {place.title}
                  </h3>
                </div>
                <div className="result-map-pager">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Previous place"
                    disabled={index === 0}
                    onClick={() => setSelection(places[index - 1].id)}
                  >
                    <Icon name="back" />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Next place"
                    disabled={index === places.length - 1}
                    onClick={() => setSelection(places[index + 1].id)}
                  >
                    <Icon name="next" />
                  </button>
                </div>
              </div>
              {(place.place_type ||
                place.subtitle ||
                place.distance_km !== undefined ||
                closest) && (
                <p className="result-map-address">
                  {[
                    place.place_type && placeTypeLabel(place.place_type),
                    place.subtitle,
                    closest
                      ? `${formatDistance(closest.km)} straight line to ${closest.number === undefined ? 'hotel' : 'stop ' + closest.number} · ${closest.title}`
                      : place.distance_km === undefined
                        ? ''
                        : `${formatDistance(place.distance_km)} from city center`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
              {planned.length > 0 && (
                <span className="stop-picker-planned">
                  <Icon name="check" size={15} /> On this day
                </span>
              )}
              {save_error?.id === place.id && (
                <p className="form-error" role="alert">
                  {save_error.message}
                </p>
              )}
              {planned.length > 0 && onEditPlanned ? (
                <div
                  className="stop-picker-saved"
                  role="group"
                  aria-label={`Planned stops at ${place.title}`}
                >
                  <SavedPlaceActions
                    place={place}
                    stops={planned}
                    onEdit={onEditPlanned}
                    onAnother={() => {
                      if (card_title.current) onPick(place, card_title.current);
                    }}
                  />
                </div>
              ) : (
                <div className="result-map-place-actions">
                  <button
                    type="button"
                    className="primary"
                    onClick={(event) => onPick(place, event.currentTarget)}
                  >
                    Review place
                  </button>
                  {onQuickAdd && place.kind === 'sight' && !planned.length && (
                    <button
                      type="button"
                      className="secondary"
                      aria-label={`Add ${place.title} to day`}
                      onClick={(event) => {
                        if (card_title.current)
                          onQuickAdd(place, card_title.current, event.currentTarget);
                      }}
                    >
                      <Icon name="plus" size={17} /> Add to day
                    </button>
                  )}
                  {onScheduleStay && place.kind === 'stay' && !planned.length && (
                    <button
                      type="button"
                      className="secondary"
                      aria-label={`Choose stay dates for ${place.title}`}
                      aria-haspopup="dialog"
                      onClick={(event) => {
                        event.currentTarget.focus({ preventScroll: true });
                        if (card_title.current) onScheduleStay(place, card_title.current);
                      }}
                    >
                      <Icon name="calendar" size={18} /> Choose dates
                    </button>
                  )}
                </div>
              )}
              <span
                className={
                  planned.some((stop) => stop.id === saved_stop_id)
                    ? 'result-map-confirmation'
                    : 'sr-only'
                }
                role="status"
              >
                {saved_message}
              </span>
            </fieldset>
          </>
        ) : (
          <div className="result-map-empty">
            {search_error ? (
              <>
                <p role="alert">{search_error}</p>
                <button type="button" className="secondary" onClick={onRetry}>
                  Try again
                </button>
              </>
            ) : (
              <p role="status">{search_status}</p>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
