import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { daysBetween, isCalendarDate, itineraryDayLabel, offsetDay } from '../lib/dates';
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
  const [date_pointer, setDatePointer] = useState(false);
  const dates = useMemo(() => {
    const from = day < first ? day : first;
    const to = day > last ? day : last;
    const span = daysBetween(from, to) + 1;
    const count = Math.min(5, span);
    const start = Math.max(0, Math.min(daysBetween(from, day) - 2, span - count));
    return Array.from({ length: count }, (_, i) => offsetDay(from, start + i));
  }, [first, last, day]);
  const selected = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const button = selected.current;
    const strip = button?.parentElement;
    if (!button || !strip) return;
    const reveal = () => button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    reveal();
    const resize = new ResizeObserver(reveal);
    resize.observe(strip);
    resize.observe(button);
    return () => resize.disconnect();
  }, [day]);

  return (
    <section className="trip-days" aria-label="Trip days">
      <button
        type="button"
        className="open-trip-overview"
        aria-label="Trip overview"
        onClick={onOverview}
      >
        <Icon name="timeline" size={18} />
        <span>Overview</span>
      </button>
      <nav className="day-strip" aria-label="Choose day">
        <button
          className="day-step"
          aria-label="Previous day"
          disabled={day <= '0000-01-01' || Boolean(trip.start_date && day <= first)}
          onClick={() => onSelect(offsetDay(day, -1))}
        >
          <Icon name="back" size={17} />
        </button>
        <div className="day-options">
          {dates.map((date) => {
            const heading = itineraryDayLabel(date, first, trip);
            const label = short_date.format(new Date(date + 'T00:00:00Z'));
            return (
              <button
                key={date}
                type="button"
                ref={date === day ? selected : undefined}
                aria-label={`${heading}, ${label}`}
                aria-current={date === day ? 'date' : undefined}
                onClick={() => onSelect(date)}
              >
                <strong>{heading}</strong>
                <time dateTime={date}>{label}</time>
              </button>
            );
          })}
        </div>
        <button
          className="day-step"
          aria-label="Next day"
          disabled={day >= '9999-12-31' || Boolean(trip.end_date && day >= last)}
          onClick={() => onSelect(offsetDay(day, 1))}
        >
          <Icon name="next" size={17} />
        </button>
      </nav>
      <label className="date-jump" title="Choose itinerary date">
        <Icon name="calendar" size={19} />
        <span aria-hidden="true">Date</span>
        <input
          aria-label="Choose itinerary date"
          data-pointer={date_pointer || undefined}
          onPointerDown={() => setDatePointer(true)}
          onKeyDown={() => setDatePointer(false)}
          onBlur={() => setDatePointer(false)}
          type="date"
          value={day}
          onChange={(event) => {
            if (isCalendarDate(event.target.value)) onSelect(event.target.value);
          }}
        />
      </label>
    </section>
  );
}
