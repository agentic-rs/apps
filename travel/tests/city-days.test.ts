import { describe, expect, test } from 'bun:test';
import { arrivalDateBounds, citiesOnDay } from '../src/lib/city-days';

const trip = {
  start_date: '2026-06-01',
  end_date: '2026-06-10',
  cities: ['Tokyo', 'Kyoto', 'Osaka'],
  city_arrival_dates: ['', '2026-06-03', '2026-06-06'],
};

describe('cities on itinerary days', () => {
  test('shows the single-city default and both ends of each transfer', () => {
    expect(
      citiesOnDay({ ...trip, cities: ['Tokyo'], city_arrival_dates: undefined }, '2026-06-05'),
    ).toEqual(['Tokyo']);
    expect(citiesOnDay(trip, '2026-06-01')).toEqual(['Tokyo']);
    expect(citiesOnDay(trip, '2026-06-03')).toEqual(['Tokyo', 'Kyoto']);
    expect(citiesOnDay(trip, '2026-06-04')).toEqual(['Kyoto']);
    expect(citiesOnDay(trip, '2026-06-06')).toEqual(['Kyoto', 'Osaka']);
    expect(citiesOnDay(trip, '2026-06-10')).toEqual(['Osaka']);
    expect(citiesOnDay(trip, '2026-06-11')).toEqual([]);
    expect(citiesOnDay(trip, '2026-05-31')).toEqual([]);
    expect(citiesOnDay(trip, '')).toEqual([]);
  });

  test('keeps all same-day transfers in order, including a return to the first city', () => {
    const route = {
      ...trip,
      cities: ['Tokyo', 'Kyoto', 'Nara', 'Tokyo'],
      city_arrival_dates: ['', '2026-06-04', '', '2026-06-04'],
    };
    expect(citiesOnDay(route, '2026-06-03')).toEqual(['Tokyo']);
    expect(citiesOnDay(route, '2026-06-04')).toEqual(route.cities);
    expect(citiesOnDay(route, '2026-06-05')).toEqual(['Tokyo']);
  });

  test('leaves uncertain days open for legacy routes or an unscheduled middle transfer', () => {
    expect(
      citiesOnDay({ ...trip, cities: undefined, city_arrival_dates: undefined }, '2026-06-01'),
    ).toEqual([]);
    expect(citiesOnDay({ ...trip, city_arrival_dates: undefined }, '2026-06-06')).toEqual([]);
    const partial = {
      ...trip,
      cities: ['Tokyo', 'Kyoto', 'Nara', 'Osaka'],
      city_arrival_dates: ['', '2026-06-03', '', '2026-06-06'],
    };
    expect(citiesOnDay(partial, '2026-06-03')).toEqual(['Tokyo', 'Kyoto']);
    expect(citiesOnDay(partial, '2026-06-04')).toEqual([]);
    expect(citiesOnDay(partial, '2026-06-06')).toEqual(['Nara', 'Osaka']);
    expect(citiesOnDay(partial, '2026-06-07')).toEqual(['Osaka']);
  });

  test('uses inclusive bounds from the route and any trip dates', () => {
    const partial = { ...trip, city_arrival_dates: ['', '2026-06-03', '', '', '2026-06-08'] };
    expect(arrivalDateBounds(partial, 1)).toEqual({ min: trip.start_date, max: '2026-06-08' });
    expect(arrivalDateBounds(partial, 3)).toEqual({ min: '2026-06-03', max: '2026-06-08' });
    expect(arrivalDateBounds(partial, 5)).toEqual({ min: '2026-06-08', max: trip.end_date });
    expect(arrivalDateBounds({ start_date: '', end_date: '' }, 1)).toEqual({ min: '', max: '' });
  });
});
