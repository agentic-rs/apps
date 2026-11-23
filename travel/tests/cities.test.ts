import { describe, expect, test } from 'bun:test';
import {
  cityKey,
  directoryCityOptions,
  more_cities,
  sameTripCity,
  searchFeaturedCities,
  suggested_cities,
} from '../src/lib/cities';
import type { DirectoryCity } from '../src/lib/offline-directory';
import { text_limits } from '../src/lib/model';

describe('offline city picker', () => {
  test('the suggested and browse lists have distinct names within the trip city limit', () => {
    const cities = [...suggested_cities, ...more_cities];
    expect(new Set(cities.map(({ name }) => cityKey(name))).size).toBe(cities.length);
    expect(cities.every(({ name, region }) => name.length <= text_limits.city_name && region)).toBe(
      true,
    );
  });

  test('matches local names, accents and full-width input to one canonical city', () => {
    for (const [input, name] of [
      ['東京', 'Tokyo'],
      ['TOKYO', 'Tokyo'],
      ['  Ｋｙōｔｏ  ', 'Kyoto'],
      ['sao paulo', 'São Paulo'],
      ['München', 'Munich'],
    ]) {
      const result = searchFeaturedCities(input);
      expect(result.matches[0].name).toBe(name);
      expect(result.custom_name).toBe('');
    }
  });

  test('finds results by country or by city and country together', () => {
    const japan = searchFeaturedCities('japan').matches;
    expect(japan.map(({ name }) => name)).toContain('Osaka');
    expect(japan.every(({ region }) => region === 'Japan')).toBe(true);
    expect(searchFeaturedCities('ky japan').matches.map(({ name }) => name)).toEqual([
      'Tokyo',
      'Kyoto',
    ]);
  });

  test('offers trimmed custom names even when a partial directory match exists', () => {
    expect(searchFeaturedCities('  Saltwind Bay  ')).toEqual({
      matches: [],
      custom_name: 'Saltwind Bay',
    });
    expect(searchFeaturedCities('York').custom_name).toBe('York');
    expect(searchFeaturedCities('  ')).toEqual({ matches: [], custom_name: '' });
  });

  test('uses stable identifiers for adjacent destinations and normalized names for legacy trips', () => {
    const illinois = { id: 'geonames:4250542' };
    const missouri = { id: 'geonames:4409896' };
    expect(sameTripCity('Springfield', illinois, 'Springfield', missouri)).toBe(false);
    expect(sameTripCity('Springfield', illinois, 'Springfield, Illinois', illinois)).toBe(true);
    expect(sameTripCity('São Paulo', null, ' SAO PAULO ', undefined)).toBe(true);
  });

  test('shows subdivisions for namesakes and stores only persistent location fields', () => {
    const springfield: DirectoryCity = {
      name: 'Springfield',
      id: 'geonames:4250542',
      country_code: 'US',
      admin1: 'Illinois',
      latitude: 39.8,
      longitude: -89.64,
      exact_match: true,
    };
    const [first, second] = directoryCityOptions([
      springfield,
      {
        ...springfield,
        id: 'geonames:4409896',
        admin1: 'Missouri',
        latitude: 37.21,
        longitude: -93.29,
      },
    ]);
    expect([first.region, second.region]).toEqual([
      'Illinois, United States',
      'Missouri, United States',
    ]);
    expect(first.location).toEqual({
      id: springfield.id,
      country_code: 'US',
      latitude: 39.8,
      longitude: -89.64,
    });
  });
});
