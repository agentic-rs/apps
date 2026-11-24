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
import { PlannedStays } from './PlannedStays';
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

function nightCount(nights: number) {
  return `${nights} ${nights === 1 ? 'night' : 'nights'}`;
}

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
  const [comparing_stays, setComparingStays] = useState(false);
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
  const first_choice = field === 'check_out' ? min_checkout : earliest;
  const page = first_choice ? stayDayPage(first_choice, last, focus) : undefined;
  const nights = dates.check_out ? daysBetween(dates.check_in, dates.check_out) : 0;
  const overlaps = useMemo(
    () => staysInRange(trip_stops, dates.check_in, dates.check_out, editing_id),
    [trip_stops, dates.check_in, dates.check_out, editing_id],
  );
  const planned_label =
    overlaps.length === 1 ? '1 planned stay' : `${overlaps.length} planned stays`;
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
    if (!page_day) return;
    // Paging moves the cursor into the new week without changing the proposed stay.
    const target = day_rows.current?.querySelector('button');
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'nearest' });
  }, [page_day]);

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
    <>
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
                    <span>{nights > 0 ? nightCount(nights) : 'Open check-out'}</span>
                    {!error && overlaps.length > 0 && (
                      <span className="sr-only">{planned_label}</span>
                    )}
                  </span>
                  {field === 'check_out' && (
                    <button type="button" onClick={() => chooseDate('')}>
                      Set check-out later
                    </button>
                  )}
                </div>
                {!error && overlaps.length > 0 && (
                  <button
                    className="stay-night-plan"
                    type="button"
                    aria-haspopup="dialog"
                    onClick={(event) => {
                      event.currentTarget.focus({ preventScroll: true });
                      setComparingStays(true);
                    }}
                  >
                    <Icon name="bed" size={17} />
                    <span>
                      <strong>{planned_label}</strong>
                      <small>
                        {overlaps
                          .slice(0, 2)
                          .map(({ stop }) => stop.title)
                          .join(' · ')}
                      </small>
                    </span>
                    <Icon name="next" size={17} />
                  </button>
                )}
              </div>
              <section aria-label="Trip days">
                <div className="stay-date-page">
                  <h3>{fields[field]} day</h3>
                  <label className="stay-date-calendar" title="Choose calendar date">
                    <Icon name="calendar" size={19} />
                    <input
                      type="date"
                      aria-label="Choose calendar date"
                      aria-invalid={Boolean(error)}
                      min={field === 'check_out' ? min_checkout || undefined : undefined}
                      max="9999-12-31"
                      disabled={!first_choice}
                      value={invalid_input ?? active_date}
                      onChange={(e) => chooseDate(e.currentTarget.value)}
                    />
                  </label>
                </div>
                {error && (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                )}
                {!first_choice && (
                  <p className="field-help">
                    Check-out is open. Choose an earlier check-in to set a departure date.
                  </p>
                )}
                <ul className="stay-date-days" ref={day_rows}>
                  {page?.dates.map((date) => {
                    const selected = date === active_date;
                    const description = [dayLabel(date), citiesOnDay(trip, date).join(' → ')]
                      .filter(Boolean)
                      .join(' · ');
                    const count =
                      field === 'check_in' ? staysForNight(trip_stops, date, editing_id).length : 0;
                    const duration_label =
                      field === 'check_out' ? nightCount(daysBetween(dates.check_in, date)) : '';
                    const occupancy = count
                      ? `${count} ${count === 1 ? 'stay' : 'stays'} that night`
                      : '';
                    return (
                      <li key={date}>
                        <button
                          type="button"
                          aria-label={`Choose ${date}`}
                          aria-description={[fields[field], description, occupancy, duration_label]
                            .filter(Boolean)
                            .join('. ')}
                          ref={date === (active_date || min_checkout) ? active_day_row : undefined}
                          aria-pressed={selected}
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
                          <span className="stay-date-row-end">
                            {duration_label && <small>{duration_label}</small>}
                            {selected && <Icon name="check" size={19} />}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {page && (page.previous || page.next) && (
                  <div className="stay-date-paging" role="group" aria-label="Trip day pages">
                    <button
                      type="button"
                      disabled={!page.previous}
                      onClick={() => setPageDay(page.previous!)}
                    >
                      <Icon name="back" size={17} /> Previous days
                    </button>
                    <button
                      type="button"
                      disabled={!page.next}
                      onClick={() => setPageDay(page.next!)}
                    >
                      Next days <Icon name="next" size={17} />
                    </button>
                  </div>
                )}
              </section>
            </div>
          </fieldset>
        </div>
      </Dialog>
      {comparing_stays && (
        <PlannedStays
          trip={trip}
          hotel={hotel}
          check_in={dates.check_in}
          check_out={dates.check_out}
          overlaps={overlaps}
          onClose={() => setComparingStays(false)}
        />
      )}
    </>
  );
}
