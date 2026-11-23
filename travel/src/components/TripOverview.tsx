import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { citiesOnDay } from '../lib/city-days';
import { continuingStays } from '../lib/hotel-stays';
import { daysBetween, isCalendarDate, itineraryDayLabel, offsetDay } from '../lib/dates';
import type { PlannedStop, Trip } from '../lib/types';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import '../trip-overview.css';

const page_size = 7;
const day_date = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const range_date = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

export function TripOverview({
  trip,
  first,
  last,
  day,
  stops,
  onSelect,
  onAddDay,
  onDismiss,
}: {
  trip: Trip;
  first: string;
  last: string;
  day: string;
  stops: PlannedStop[];
  onSelect(day: string): void;
  onAddDay(): Promise<void>;
  onDismiss(): void;
}) {
  const from = day < first ? day : first;
  const to = day > last ? day : last;
  const total_days = daysBetween(from, to) + 1;
  const [anchor, setAnchor] = useState(day);
  const anchor_index = Math.max(0, Math.min(daysBetween(from, anchor), total_days - 1));
  const page_start = Math.floor(anchor_index / page_size) * page_size;
  const page_count = Math.min(page_size, total_days - page_start);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const adding = useRef(false);
  const anchor_row = useRef<HTMLButtonElement>(null);
  const stops_by_day = useMemo(() => {
    const grouped = new Map<string, string[]>();
    for (const stop of stops) {
      const titles = grouped.get(stop.day);
      if (titles) titles.push(stop.title);
      else grouped.set(stop.day, [stop.title]);
    }
    return grouped;
  }, [stops]);

  useLayoutEffect(() => {
    anchor_row.current?.scrollIntoView({ block: 'nearest' });
  }, [anchor, page_start]);

  async function addDay() {
    if (adding.current || to >= '9999-12-31') return;
    adding.current = true;
    setSaving(true);
    setError('');
    try {
      await onAddDay();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not add a day to this trip.');
    } finally {
      adding.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog title="Trip overview" full_screen dismiss_disabled={saving} onDismiss={onDismiss}>
      <div className="trip-overview">
        <header className="overview-heading">
          <h3>{trip.title}</h3>
          <p>
            {range_date.formatRange(new Date(from + 'T00:00:00Z'), new Date(to + 'T00:00:00Z'))}
            {' · '}
            {total_days} {total_days === 1 ? 'day' : 'days'}
          </p>
        </header>
        {total_days > page_size && (
          <nav className="overview-pages" aria-label="Browse itinerary days">
            <button
              className="icon-button"
              aria-label="Previous days"
              disabled={saving || page_start === 0}
              onClick={() => setAnchor(offsetDay(from, page_start - page_size))}
            >
              <Icon name="back" size={18} />
            </button>
            <input
              aria-label="Jump to overview date"
              type="date"
              value={anchor}
              min={from}
              max={to}
              disabled={saving}
              onChange={(event) => {
                const value = event.target.value;
                if (isCalendarDate(value) && value >= from && value <= to) setAnchor(value);
              }}
            />
            <button
              className="icon-button"
              aria-label="Next days"
              disabled={saving || page_start + page_count >= total_days}
              onClick={() => setAnchor(offsetDay(from, page_start + page_size))}
            >
              <Icon name="next" size={18} />
            </button>
          </nav>
        )}
        <ol className="overview-days" aria-label="Daily itineraries">
          {Array.from({ length: page_count }, (_, i) => {
            const date = offsetDay(from, page_start + i);
            const heading = itineraryDayLabel(date, first, trip);
            const cities = citiesOnDay(trip, date).join(' → ');
            const titles = stops_by_day.get(date) ?? [];
            const stays = continuingStays(stops, date);
            const summary =
              titles.slice(0, 3).join(' · ') +
              (titles.length > 3 ? ` · +${titles.length - 3} more` : '');
            const lines = [summary, ...stays.map((stay) => stay.label)].filter(Boolean);
            if (!lines.length) lines.push('No stops planned');
            return (
              <li key={date}>
                <button
                  className="overview-day"
                  ref={date === anchor ? anchor_row : undefined}
                  aria-label={`Open itinerary for ${date}`}
                  aria-description={`${heading}. ${cities || 'City not scheduled'}. ${lines.join('. ')}.`}
                  aria-current={date === day ? 'date' : undefined}
                  disabled={saving}
                  onClick={() => onSelect(date)}
                >
                  <span className="overview-day-date">
                    <strong>{heading}</strong>
                    <time dateTime={date}>{day_date.format(new Date(date + 'T00:00:00Z'))}</time>
                  </span>
                  <span className="overview-day-plan">
                    <strong>{cities || 'City not scheduled'}</strong>
                    {lines.map((line, index) => (
                      <span key={index}>{line}</span>
                    ))}
                  </span>
                  <Icon name="next" size={16} />
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      <footer className="dialog-footer overview-footer">
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="secondary"
          disabled={saving || to >= '9999-12-31'}
          onClick={() => void addDay()}
        >
          <Icon name="plus" size={17} />
          {saving ? 'Adding…' : 'Add day'}
        </button>
      </footer>
    </Dialog>
  );
}
