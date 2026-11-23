import { useRef, useState } from 'react';
import { citiesOnDay } from '../lib/city-days';
import { daysBetween, isCalendarDate, itineraryDayLabel } from '../lib/dates';
import { checkoutAfter, moveStayCheckIn, stayDayPage } from '../lib/hotel-stays';
import type { Trip } from '../lib/types';
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
  first,
  check_in,
  check_out,
  onApply,
  onClose,
  initial_field = 'check_in',
}: {
  trip: Trip;
  first: string;
  check_in: string;
  check_out: string;
  onApply(check_in: string, check_out: string): void;
  onClose(): void;
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
  const departure = useRef<HTMLButtonElement>(null);
  const earliest = [first, trip.start_date, dates.check_in].filter(isCalendarDate).sort()[0];
  const last = [
    trip.end_date ? checkoutAfter(trip.end_date, 1) || trip.end_date : '9999-12-31',
    dates.check_in,
    dates.check_out,
    first,
  ]
    .filter(isCalendarDate)
    .sort()
    .at(-1)!;
  const min_checkout = checkoutAfter(dates.check_in, 1);
  const active_date = dates[field];
  const focus = page_day || active_date || min_checkout || dates.check_in;
  const page = stayDayPage(earliest, last, focus);
  const nights = dates.check_out ? daysBetween(dates.check_in, dates.check_out) : 0;
  const error =
    invalid_input === null
      ? ''
      : field === 'check_in'
        ? 'Choose a check-in date.'
        : 'Choose a check-out date after check-in.';

  function selectField(next: Field) {
    setField(next);
    setPageDay('');
    setInvalidInput(null);
  }

  function chooseDate(value: string, from_list = false) {
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
      if (from_list) {
        setField('check_out');
        departure.current?.focus({ preventScroll: true });
      }
    } else {
      setDates({ ...dates, check_out: value });
    }
    setPageDay('');
    setInvalidInput(null);
  }

  function dayLabel(value: string) {
    return itineraryDayLabel(value, first, trip);
  }

  return (
    <Dialog
      title="Stay dates"
      full_screen
      onDismiss={onClose}
      leading_action={
        <button className="stay-date-nav" type="button" onClick={onClose}>
          Cancel
        </button>
      }
      trailing_action={
        <button
          className="stay-date-nav"
          type="button"
          disabled={Boolean(error)}
          onClick={() => {
            onApply(dates.check_in, dates.check_out);
            onClose();
          }}
        >
          Done
        </button>
      }
    >
      <div className="stay-date-scroll">
        <div className="stay-date-body">
          <div className="stay-date-range">
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
              <span role="status">
                <Icon name="bed" size={17} />
                {nights > 0 ? `${nights} ${nights === 1 ? 'night' : 'nights'}` : 'Open check-out'}
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
          </div>
          <section aria-label="Trip days">
            <div className="stay-date-page">
              <h3>Trip days</h3>
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
            <ul className="stay-date-days">
              {page.dates.map((date) => {
                const selected = date === active_date;
                const description = [dayLabel(date), citiesOnDay(trip, date).join(' → ')]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <li key={date}>
                    <button
                      type="button"
                      aria-label={`Choose ${date}`}
                      aria-description={description}
                      aria-pressed={selected}
                      disabled={field === 'check_out' && date <= dates.check_in}
                      onClick={() => chooseDate(date, true)}
                    >
                      <span>
                        <strong>{row_date.format(new Date(date + 'T00:00:00Z'))}</strong>
                        <small>{description}</small>
                      </span>
                      {selected && <Icon name="check" size={19} />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>
    </Dialog>
  );
}
