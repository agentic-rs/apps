import { daysBetween, isCalendarDate, offsetDay } from './dates';
import type { PlannedStop } from './types';

export function checkoutAfter(day: string, nights: number): string {
  if (!isCalendarDate(day) || day === '9999-12-31' || !Number.isSafeInteger(nights) || nights < 1)
    return '';
  return offsetDay(day, Math.min(nights, daysBetween(day, '9999-12-31')));
}

/** Moving a stay keeps booked nights or its explicitly open departure. */
export function moveStayCheckIn(check_in: string, check_out: string, next: string): string {
  if (!check_out) return '';
  const nights =
    isCalendarDate(check_in) && isCalendarDate(check_out)
      ? Math.max(1, daysBetween(check_in, check_out))
      : 1;
  return checkoutAfter(next, nights);
}

/** Only materialize the page containing the target, even for an open-ended trip. */
export function stayDayPage(first: string, last: string, target: string) {
  const count = daysBetween(first, last) + 1;
  const index = Math.max(0, Math.min(count - 1, daysBetween(first, target)));
  const start = Math.floor(index / 7) * 7;
  return {
    dates: Array.from({ length: Math.min(7, count - start) }, (_, i) =>
      offsetDay(first, start + i),
    ),
    previous: start > 0 ? offsetDay(first, start - 7) : undefined,
    next: start + 7 < count ? offsetDay(first, start + 7) : undefined,
  };
}

export interface ContinuingStay {
  stop: PlannedStop;
  label: string;
}

export function isContinuingStay(stop: PlannedStop, day: string): boolean {
  return stop.kind === 'stay' && stop.day < day && day <= (stop.checkout_date ?? '');
}

export function continuingStays(stops: readonly PlannedStop[], day: string): ContinuingStay[] {
  return stops
    .filter((stop) => isContinuingStay(stop, day))
    .map((stop) => ({
      stop,
      label: `${day === stop.checkout_date ? 'Check out of' : 'Staying at'} ${stop.title}`,
    }));
}
