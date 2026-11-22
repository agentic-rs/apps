import { useMemo } from 'react';
import {
  daysBetween,
  formatTripDates,
  isCalendarDate,
  itineraryDayLabel,
  offsetDay,
} from '../lib/dates';
import { Icon } from './Icon';
import type { Trip } from '../lib/types';

const short_date = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

// Render a small window even when a trip or its imported journal spans many years.
export function TripDays({
  trip,
  first,
  last,
  day,
  onSelect,
  onOverview,
}: {
  trip: Trip;
  first: string;
  last: string;
  day: string;
  onSelect(day: string): void;
  onOverview(): void;
}) {
  const dates = useMemo(() => {
    const from = day < first ? day : first;
    const to = day > last ? day : last;
    const span = daysBetween(from, to) + 1;
    const count = Math.min(5, span);
    const start = Math.max(0, Math.min(daysBetween(from, day) - 2, span - count));
    return Array.from({ length: count }, (_, i) => offsetDay(from, start + i));
  }, [first, last, day]);

  return (
    <section className="trip-days" aria-label="Trip days">
      <div className="day-controls">
        <button className="open-trip-overview" aria-label="Trip overview" onClick={onOverview}>
          <Icon name="timeline" size={17} />
          Overview
        </button>
        <span className="trip-dates-caption">
          {formatTripDates(trip.start_date, trip.end_date)}
        </span>
        <label className="date-jump">
          <span className="sr-only">Choose date</span>
          <input
            aria-label="Choose itinerary date"
            type="date"
            value={day}
            onChange={(event) => {
              if (isCalendarDate(event.target.value)) onSelect(event.target.value);
            }}
          />
        </label>
      </div>
      <nav className="day-strip" aria-label="Choose day">
        <button
          className="day-step"
          aria-label="Previous day"
          disabled={day <= '0000-01-01' || Boolean(trip.start_date && day <= first)}
          onClick={() => onSelect(offsetDay(day, -1))}
        >
          <Icon name="back" size={17} />
        </button>
        {dates.map((date) => {
          const heading = itineraryDayLabel(date, first, trip);
          const label = short_date.format(new Date(date + 'T00:00:00Z'));
          return (
            <button
              key={date}
              aria-label={`${heading}, ${label}`}
              aria-current={date === day ? 'date' : undefined}
              onClick={() => onSelect(date)}
            >
              <strong>{heading}</strong>
              <span>{label}</span>
            </button>
          );
        })}
        <button
          className="day-step"
          aria-label="Next day"
          disabled={day >= '9999-12-31' || Boolean(trip.end_date && day >= last)}
          onClick={() => onSelect(offsetDay(day, 1))}
        >
          <Icon name="next" size={17} />
        </button>
      </nav>
    </section>
  );
}
