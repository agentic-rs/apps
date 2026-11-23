import type { PlannedStop } from './types';

export function isContinuingStay(stop: PlannedStop, day: string): boolean {
  return stop.kind === 'stay' && stop.day < day && day <= (stop.checkout_date ?? '');
}

export function continuingStays(stops: readonly PlannedStop[], day: string) {
  return stops
    .filter((stop) => isContinuingStay(stop, day))
    .map((stop) => ({
      stop,
      label: `${day === stop.checkout_date ? 'Check out of' : 'Staying at'} ${stop.title}`,
    }));
}
