import type { Trip } from './types';
import { isCalendarDate } from './dates';

type TripSchedule = Pick<Trip, 'start_date' | 'end_date' | 'city_arrival_dates'>;

export function arrivalDateBounds(trip: TripSchedule, city_index: number) {
  const dates = trip.city_arrival_dates ?? [];
  let min = trip.start_date;
  let max = trip.end_date;
  for (let index = 1; index < dates.length; index++) {
    const date = dates[index];
    if (index < city_index && date > min) min = date;
    if (index > city_index && date && (!max || date < max)) max = date;
  }
  return { min, max };
}

/** Show only the cities that the traveler’s route and chosen dates establish. */
export function cityIndicesOnDay(trip: TripSchedule & Pick<Trip, 'cities'>, day: string): number[] {
  const cities = trip.cities ?? [];
  if (
    !isCalendarDate(day) ||
    (trip.start_date && day < trip.start_date) ||
    (trip.end_date && day > trip.end_date)
  ) {
    return [];
  }
  if (cities.length <= 1) return cities.length ? [0] : [];
  const dates = trip.city_arrival_dates ?? [];
  const arrival = dates.indexOf(day, 1);
  if (arrival !== -1) {
    // Undated visits between two transfers on this day must also fall on it.
    const first = arrival - 1;
    return Array.from({ length: dates.lastIndexOf(day) - first + 1 }, (_, index) => first + index);
  }

  let previous = 0;
  let next = cities.length;
  for (let index = 1; index < dates.length; index++) {
    if (!dates[index]) continue;
    if (dates[index] > day) {
      next = index;
      break;
    }
    previous = index;
  }
  return next === previous + 1 ? [previous] : [];
}

export function citiesOnDay(trip: TripSchedule & Pick<Trip, 'cities'>, day: string): string[] {
  return cityIndicesOnDay(trip, day).map((index) => trip.cities![index]);
}
