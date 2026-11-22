const minute_ms = 60_000;
const day_ms = 24 * 60 * minute_ms;

export function validateOffset(offset: number): number {
  if (!Number.isInteger(offset) || offset < -840 || offset > 840) {
    throw new Error('Choose a time zone offset between −14:00 and +14:00.');
  }
  return offset;
}

/** Validate the calendar date as well as its spelling: Date.parse normalizes some invalid days. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function calendarDayMillis(day: string): number {
  if (!isCalendarDate(day)) throw new Error('Choose a valid calendar date.');
  return Date.parse(`${day}T00:00:00.000Z`);
}

export function daysBetween(start: string, end: string): number {
  return (calendarDayMillis(end) - calendarDayMillis(start)) / day_ms;
}

export function offsetDay(day: string, offset: number): string {
  if (!Number.isSafeInteger(offset)) throw new Error('The number of days must be a whole number.');
  const shifted = new Date(calendarDayMillis(day) + offset * day_ms);
  const year = shifted.getUTCFullYear();
  if (!Number.isFinite(year) || year < 0 || year > 9999)
    throw new Error('The day is outside the supported date range.');
  return shifted.toISOString().slice(0, 10);
}

export function isUtcTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const date = new Date(value);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString() === (value.includes('.') ? value : value.replace('Z', '.000Z'))
  );
}

function shiftedDate(iso: string, offset: number): Date {
  validateOffset(offset);
  if (!isUtcTimestamp(iso)) throw new Error('The visit time is invalid.');
  const shifted = new Date(Date.parse(iso) + offset * minute_ms);
  if (shifted.getUTCFullYear() < 0 || shifted.getUTCFullYear() > 9999) {
    throw new Error('The visit time is outside the supported date range.');
  }
  return shifted;
}

/** A recorded visit keeps its wall-clock time even after the device changes time zones. */
export function toVisitInput(iso: string, offset: number): string {
  return shiftedDate(iso, offset).toISOString().slice(0, 16);
}

export function fromVisitInput(local_string: string, offset: number): string {
  validateOffset(offset);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local_string)) {
    throw new Error('Enter a complete visit date and time.');
  }
  const wall_clock = `${local_string}:00.000Z`;
  if (!isUtcTimestamp(wall_clock)) throw new Error('Enter a valid visit date and time.');
  const result = new Date(Date.parse(wall_clock) - offset * minute_ms).toISOString();
  if (!isUtcTimestamp(result))
    throw new Error('The visit time is outside the supported date range.');
  return result;
}

/** Minutes east of UTC, matching ISO-8601's sign convention. */
export function currentOffsetMinutes(date = new Date()): number {
  return -date.getTimezoneOffset();
}

export function formatVisitDate(iso: string, offset: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(shiftedDate(iso, offset));
}

export function formatVisitTime(iso: string, offset: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(shiftedDate(iso, offset));
}

export function formatTripDates(start_date: string, end_date: string): string {
  const format = (value: string) => {
    if (!isCalendarDate(value)) throw new Error('The trip date is invalid.');
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${value}T00:00:00.000Z`));
  };
  if (!start_date && !end_date) return 'Dates open';
  if (!start_date) return `Until ${format(end_date)}`;
  if (!end_date || start_date === end_date) return format(start_date);
  return `${format(start_date)} – ${format(end_date)}`;
}
