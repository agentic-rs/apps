import { useId, useLayoutEffect, useRef } from 'react';
import { useBackLayer } from '../lib/back-navigation';
import { formatDistance } from '../lib/distance';
import { matchesPlannedPlace } from '../lib/planned-stop-search';
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
          <small>{savedSchedule(stop)}</small>
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
          {(place.subtitle || place.distance_km !== undefined) && (
            <small>
              {place.subtitle}
              {place.subtitle && place.distance_km !== undefined && ' · '}
              {place.distance_km !== undefined &&
                `${formatDistance(place.distance_km)} from city center`}
            </small>
          )}
          {planned.length > 0 && (
            <span className="stop-picker-planned">
              <Icon name="check" size={12} /> On this day
            </span>
          )}
        </span>
        {!can_add && <Icon name="next" size={16} />}
      </button>
      {can_add && (
        <button
          type="button"
          className="stop-picker-add"
          aria-label={adding ? `Adding ${place.title}` : `Add ${place.title} to day`}
          onClick={(event) => {
            if (row.current) onQuickAdd?.(row.current, event.currentTarget);
          }}
        >
          <Icon name="plus" size={24} />
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
          {planned.map((stop, index) => (
            <button
              ref={index === 0 ? edit : undefined}
              key={stop.id}
              type="button"
              onClick={() => onEditPlanned(stop)}
            >
              <Icon name="edit" size={17} />
              <span>
                <strong>
                  Edit planned {stop.kind === 'stay' ? 'stay' : 'visit'}
                  {planned.length > 1 && ` ${index + 1}`}
                </strong>
                <small>
                  {stop.title !== place.title && `${stop.title} · `}
                  {savedSchedule(stop)}
                </small>
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              collapse();
              if (row.current) onPick(row.current);
            }}
          >
            <Icon name="plus" size={17} /> Add another {place.kind === 'stay' ? 'stay' : 'visit'}
          </button>
        </div>
      )}
    </li>
  );
}
