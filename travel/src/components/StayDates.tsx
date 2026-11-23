import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { citiesOnDay } from '../lib/city-days';
import { daysBetween, isCalendarDate, itineraryDayLabel } from '../lib/dates';
import {
  checkoutAfter,
  moveStayCheckIn,
  stayDayPage,
  staysForNight,
  staysInRange,
} from '../lib/hotel-stays';
import type { PlannedStop, Trip } from '../lib/types';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import '../stay-dates.css';

type Field = 'check_in' | 'check_out';
const fields = { check_in: 'Check-in', check_out: 'Check-out' } as const;
const full_date = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const row_date = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

export function StayDates({
  trip,
  trip_stops,
  editing_id,
  adding_stay,
  first,
  check_in,
  check_out,
  onApply,
  onClose,
  hotel,
  initial_field = 'check_in',
}: {
  trip: Trip;
  trip_stops: readonly PlannedStop[];
  editing_id?: string;
  adding_stay: boolean;
  first: string;
  check_in: string;
  check_out: string;
  onApply(check_in: string, check_out: string): void | Promise<void>;
  onClose(applied?: boolean): void;
  hotel?: { title: string; city?: string };
  initial_field?: Field;
}) {
  const [dates, setDates] = useState(() => {
    const arrival = isCalendarDate(check_in) ? check_in : first;
    return {
      check_in: arrival,
      check_out: isCalendarDate(check_out) && check_out > arrival ? check_out : '',
    };
  });
  const [field, setField] = useState<Field>(isCalendarDate(check_in) ? initial_field : 'check_in');
  const [page_day, setPageDay] = useState('');
  // Keep a partially edited native input separate from the last valid range.
  const [invalid_input, setInvalidInput] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [save_error, setSaveError] = useState('');
  const in_flight = useRef(false);
  const departure = useRef<HTMLButtonElement>(null);
  const day_rows = useRef<HTMLUListElement>(null);
  const scroll_area = useRef<HTMLDivElement>(null);
  const active_day_row = useRef<HTMLButtonElement>(null);
  const return_to_days = useRef(false);
  const earliest = [first, trip.start_date, dates.check_in].filter(isCalendarDate).sort()[0];
  const min_checkout = checkoutAfter(dates.check_in, 1);
  const last = [
    trip.end_date ? checkoutAfter(trip.end_date, 1) || trip.end_date : '9999-12-31',
    dates.check_in,
    min_checkout,
    dates.check_out,
    first,
  ]
    .filter(isCalendarDate)
    .sort()
    .at(-1)!;
  const active_date = dates[field];
  const focus = page_day || active_date || min_checkout || dates.check_in;
  const page = stayDayPage(earliest, last, focus);
  const nights = dates.check_out ? daysBetween(dates.check_in, dates.check_out) : 0;
  const overlaps = useMemo(
    () => staysInRange(trip_stops, dates.check_in, dates.check_out, editing_id),
    [trip_stops, dates.check_in, dates.check_out, editing_id],
  );
  const error =
    invalid_input === null
      ? ''
      : field === 'check_in'
        ? 'Choose a check-in date.'
        : 'Choose a check-out date after check-in.';

  useLayoutEffect(() => {
    if (!return_to_days.current) return;
    return_to_days.current = false;
    // The new checkout can be on another page. Its row exists only after the range updates.
    const target = active_day_row.current ?? departure.current;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'nearest' });
  }, [dates]);

  useLayoutEffect(() => {
    const viewport = scroll_area.current;
    if (!viewport) return;
    const resize = new ResizeObserver(() => {
      const focused = document.activeElement;
      if (focused && day_rows.current?.contains(focused))
        focused.scrollIntoView({ block: 'nearest' });
    });
    resize.observe(viewport);
    return () => resize.disconnect();
  }, []);

  function selectField(next: Field) {
    setField(next);
    setPageDay('');
    setInvalidInput(null);
  }

  function chooseDate(value: string, from_list = false) {
    setSaveError('');
    if (value === '' && field === 'check_out') {
      setDates({ ...dates, check_out: '' });
    } else if (!isCalendarDate(value) || (field === 'check_out' && value <= dates.check_in)) {
      setInvalidInput(value);
      return;
    } else if (field === 'check_in') {
      setDates({
        check_in: value,
        check_out: moveStayCheckIn(dates.check_in, dates.check_out, value),
      });
      if (from_list) setField('check_out');
    } else {
      setDates({ ...dates, check_out: value });
    }
    return_to_days.current = from_list;
    setPageDay('');
    setInvalidInput(null);
  }

  function dayLabel(value: string) {
    return itineraryDayLabel(value, first, trip);
  }

  function cancel() {
    if (!in_flight.current) onClose(false);
  }

  async function apply() {
    if (error || in_flight.current) return;
    in_flight.current = true;
    setSaving(true);
    setSaveError('');
    try {
      await onApply(dates.check_in, dates.check_out);
    } catch (reason) {
      setSaveError(
        reason instanceof Error ? reason.message : 'Could not save the stay. Try again.',
      );
      in_flight.current = false;
      setSaving(false);
      return;
    }
    onClose(true);
  }

  return (
    <Dialog
      title="Stay dates"
      full_screen
      dismiss_disabled={saving}
      onDismiss={cancel}
      leading_action={
        <button className="stay-date-nav" type="button" disabled={saving} onClick={cancel}>
          Cancel
        </button>
      }
      trailing_action={
        <button
          className="stay-date-nav"
          type="button"
          disabled={Boolean(error) || saving}
          onClick={() => void apply()}
        >
          {saving ? 'Saving…' : adding_stay ? 'Add stay' : 'Done'}
        </button>
      }
    >
      {save_error && (
        <p className="stay-date-save-error form-error" role="alert">
          {save_error}
        </p>
      )}
      <div className="stay-date-scroll" ref={scroll_area}>
        <fieldset className="stay-date-fields" disabled={saving}>
          <div className="stay-date-body">
            <div className="stay-date-range">
              {hotel && (
                <header className="stay-date-hotel">
                  <h3>{hotel.title}</h3>
                  {hotel.city && <p>{hotel.city}</p>}
                </header>
              )}
              <div className="stay-date-endpoints" role="group" aria-label="Stay endpoints">
                {(['check_in', 'check_out'] as const).map((item) => {
                  const value = dates[item];
                  const formatted = value
                    ? full_date.format(new Date(value + 'T00:00:00Z'))
                    : 'Not set';
                  return (
                    <button
                      key={item}
                      type="button"
                      ref={item === 'check_out' ? departure : undefined}
                      aria-label={fields[item]}
                      aria-pressed={field === item}
                      aria-description={value ? `${formatted} · ${dayLabel(value)}` : formatted}
                      onClick={() => selectField(item)}
                    >
                      <span>{fields[item]}</span>
                      <strong>{formatted}</strong>
                      {value && <small>{dayLabel(value)}</small>}
                    </button>
                  );
                })}
              </div>
              <div className="stay-date-summary">
                <span role="status" aria-atomic="true">
                  <Icon name="bed" size={17} />
                  <span>
                    {nights > 0
                      ? `${nights} ${nights === 1 ? 'night' : 'nights'}`
                      : 'Open check-out'}
                  </span>
                  {!error && overlaps.length > 0 && (
                    <span className="sr-only">
                      {overlaps.length === 1
                        ? '1 stay already planned.'
                        : `${overlaps.length} stays already planned.`}
                    </span>
                  )}
                </span>
                {field === 'check_out' && (
                  <button type="button" onClick={() => chooseDate('')}>
                    Set check-out later
                  </button>
                )}
              </div>
              <label className="stay-date-calendar">
                <Icon name="calendar" size={19} />
                <span>Choose calendar date</span>
                <span className="stay-date-calendar-arrow">
                  <Icon name="next" size={17} />
                </span>
                <input
                  type="date"
                  aria-label="Choose calendar date"
                  aria-invalid={Boolean(error)}
                  min={field === 'check_out' ? min_checkout || undefined : undefined}
                  max="9999-12-31"
                  disabled={field === 'check_out' && !min_checkout}
                  value={invalid_input ?? active_date}
                  onChange={(e) => chooseDate(e.currentTarget.value)}
                />
              </label>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              {!error && overlaps.length > 0 && (
                <section className="stay-night-plan" aria-label="Planned for these nights">
                  <h3>
                    <Icon name="bed" size={17} />
                    {nights > 1
                      ? 'Already planned for these nights'
                      : 'Already planned for this night'}
                  </h3>
                  <ul>
                    {overlaps.map(({ stop, first_night, last_night }) => (
                      <li key={stop.id}>
                        <strong>{stop.title}</strong>
                        <small>
                          {stop.city && <>{stop.city} · </>}
                          {first_night === last_night ? 'Night of ' : 'Nights of '}
                          <time dateTime={first_night}>
                            {row_date.format(new Date(first_night + 'T00:00:00Z'))}
                          </time>
                          {first_night !== last_night && (
                            <>
                              {' '}
                              –{' '}
                              <time dateTime={last_night}>
                                {row_date.format(new Date(last_night + 'T00:00:00Z'))}
                              </time>
                            </>
                          )}
                        </small>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
            <section aria-label="Trip days">
              <div className="stay-date-page">
                <h3>{field === 'check_in' ? 'Choose check-in day' : 'Choose check-out day'}</h3>
                {(page.previous || page.next) && (
                  <div>
                    <button
                      type="button"
                      aria-label="Previous days"
                      disabled={!page.previous}
                      onClick={() => setPageDay(page.previous!)}
                    >
                      <Icon name="back" size={17} />
                    </button>
                    <button
                      type="button"
                      aria-label="Next days"
                      disabled={!page.next}
                      onClick={() => setPageDay(page.next!)}
                    >
                      <Icon name="next" size={17} />
                    </button>
                  </div>
                )}
              </div>
              <ul className="stay-date-days" ref={day_rows}>
                {page.dates.map((date) => {
                  const selected = date === active_date;
                  const description = [dayLabel(date), citiesOnDay(trip, date).join(' → ')]
                    .filter(Boolean)
                    .join(' · ');
                  const count = staysForNight(trip_stops, date, editing_id).length;
                  const occupancy = count
                    ? `${count} ${count === 1 ? 'stay' : 'stays'} that night`
                    : '';
                  return (
                    <li key={date}>
                      <button
                        type="button"
                        aria-label={`Choose ${date}`}
                        aria-description={[fields[field], description, occupancy]
                          .filter(Boolean)
                          .join('. ')}
                        ref={date === (active_date || min_checkout) ? active_day_row : undefined}
                        aria-pressed={selected}
                        disabled={field === 'check_out' && date <= dates.check_in}
                        onClick={() => chooseDate(date, true)}
                      >
                        <span>
                          <strong>{row_date.format(new Date(date + 'T00:00:00Z'))}</strong>
                          <small>{description}</small>
                          {occupancy && (
                            <small className="stay-night-count">
                              <Icon name="bed" size={14} />
                              {occupancy}
                            </small>
                          )}
                        </span>
                        {selected && <Icon name="check" size={19} />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
        </fieldset>
      </div>
    </Dialog>
  );
}
