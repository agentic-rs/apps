import { useId, useLayoutEffect, useRef, type Ref } from 'react';
import { useBackLayer } from '../lib/back-navigation';
import { formatDistance } from '../lib/distance';
import { matchesPlannedPlace } from '../lib/planned-stop-search';
import { placeTypeLabel } from '../lib/place-types';
import type { StopSearchResult } from '../lib/stop-lookup';
import type { PlannedStop } from '../lib/types';
import { Icon } from './Icon';

const place_icons = {
  sight: 'landmark',
  stay: 'bed',
  food: 'food',
  transport: 'route',
  other: 'pin',
} as const;
const calendar_date = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

function savedSchedule(stop: PlannedStop): string {
  if (stop.kind !== 'stay') return stop.time || 'Time not set';
  const start = new Date(stop.day + 'T00:00:00Z');
  const end = stop.checkout_date && new Date(stop.checkout_date + 'T00:00:00Z');
  return [end ? calendar_date.formatRange(start, end) : calendar_date.format(start), stop.time]
    .filter(Boolean)
    .join(' · ');
}

export function SavedPlaceActions({
  place,
  stops,
  onEdit,
  onAnother,
  first_ref,
}: {
  place: StopSearchResult;
  stops: PlannedStop[];
  onEdit(stop: PlannedStop): void;
  onAnother(): void;
  first_ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <>
      {stops.map((stop, index) => (
        <button
          ref={index === 0 ? first_ref : undefined}
          key={stop.id}
          type="button"
          onClick={() => onEdit(stop)}
        >
          <Icon name="edit" size={17} />
          <span>
            <strong>
              Edit planned {stop.kind === 'stay' ? 'stay' : 'visit'}
              {stops.length > 1 && ` ${index + 1}`}
            </strong>
            <small>
              {stop.title !== place.title && `${stop.title} · `}
              {savedSchedule(stop)}
            </small>
          </span>
        </button>
      ))}
      <button type="button" onClick={onAnother}>
        <Icon name="plus" size={17} /> Add another {place.kind === 'stay' ? 'stay' : 'visit'}
      </button>
    </>
  );
}

export function PlannedSearchResult({
  stop,
  onEdit,
}: {
  stop: PlannedStop;
  onEdit(stop: PlannedStop): void;
}) {
  return (
    <li>
      <button
        className="stop-picker-result"
        type="button"
        aria-label={`Edit planned stop ${stop.title}`}
        onClick={() => onEdit(stop)}
      >
        <span className="stop-picker-pin" data-kind={stop.kind}>
          <Icon name={place_icons[stop.kind]} size={21} />
        </span>
        <span className="stop-picker-label">
          <strong>{stop.title}</strong>
          <small>
            {[
              stop.directory_ref?.place_type && placeTypeLabel(stop.directory_ref.place_type),
              savedSchedule(stop),
            ]
              .filter(Boolean)
              .join(' · ')}
          </small>
        </span>
        <Icon name="edit" size={16} />
      </button>
    </li>
  );
}

export function StopPlaceResult({
  place,
  day_stops,
  expanded,
  onExpand,
  onEditPlanned,
  onQuickAdd,
  onScheduleStay,
  adding,
  error,
  onPick,
}: {
  place: StopSearchResult;
  day_stops: PlannedStop[];
  expanded: boolean;
  onExpand(expanded: boolean): void;
  onEditPlanned?(stop: PlannedStop): void;
  onQuickAdd?(row: HTMLElement, button: HTMLElement): void;
  onScheduleStay?(origin: HTMLElement): void;
  adding: boolean;
  error?: string;
  onPick(origin: HTMLElement): void;
}) {
  const id = useId();
  const row = useRef<HTMLButtonElement>(null);
  const edit = useRef<HTMLButtonElement>(null);
  const planned = day_stops.filter((stop) => matchesPlannedPlace(stop, place));
  const expandable = Boolean(planned.length && onEditPlanned);
  const can_add = !planned.length && Boolean(onQuickAdd);
  const can_schedule = !planned.length && Boolean(onScheduleStay);
  const open = expandable && expanded;
  useBackLayer(open, collapse);
  useLayoutEffect(() => {
    if (open) edit.current?.focus();
  }, [open]);
  function collapse() {
    onExpand(false);
    row.current?.focus();
  }
  return (
    <li className="stop-place-option">
      <button
        ref={row}
        type="button"
        className="stop-picker-result"
        aria-expanded={expandable ? open : undefined}
        aria-controls={open ? id : undefined}
        onClick={(event) => (expandable ? onExpand(!open) : onPick(event.currentTarget))}
      >
        <span className="stop-picker-pin" data-kind={place.kind}>
          <Icon
            name={place.source === 'ourairports' ? 'plane' : place_icons[place.kind]}
            size={21}
          />
        </span>
        <span className="stop-picker-label">
          <strong>{place.title}</strong>
          {(place.place_type || place.subtitle || place.distance_km !== undefined) && (
            <small>
              {[
                place.place_type && placeTypeLabel(place.place_type),
                place.subtitle,
                place.distance_km !== undefined &&
                  `${formatDistance(place.distance_km)} from city center`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </small>
          )}
          {planned.length > 0 && (
            <span className="stop-picker-planned">
              <Icon name="check" size={12} /> On this day
            </span>
          )}
        </span>
        {!can_add && !can_schedule && <Icon name="next" size={16} />}
      </button>
      {can_add && (
        <button
          type="button"
          className="stop-picker-quick-action"
          aria-label={adding ? `Adding ${place.title}` : `Add ${place.title} to day`}
          onClick={(event) => {
            if (row.current) onQuickAdd?.(row.current, event.currentTarget);
          }}
        >
          <Icon name="plus" size={24} />
        </button>
      )}
      {can_schedule && (
        <button
          type="button"
          className="stop-picker-quick-action stop-picker-calendar"
          aria-label={`Choose stay dates for ${place.title}`}
          aria-haspopup="dialog"
          onClick={(event) => {
            event.currentTarget.focus({ preventScroll: true });
            if (row.current) onScheduleStay?.(row.current);
          }}
        >
          <Icon name="calendar" size={22} />
        </button>
      )}
      {error && (
        <p className="stop-picker-save-error" role="alert">
          {error}
        </p>
      )}
      {open && onEditPlanned && (
        <div
          id={id}
          className="stop-picker-saved"
          role="group"
          aria-label={`Planned stops at ${place.title}`}
        >
          <SavedPlaceActions
            place={place}
            stops={planned}
            onEdit={onEditPlanned}
            first_ref={edit}
            onAnother={() => {
              collapse();
              if (row.current) onPick(row.current);
            }}
          />
        </div>
      )}
    </li>
  );
}
