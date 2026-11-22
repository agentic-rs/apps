import { describe, expect, test } from 'bun:test';
import { cityKey, more_cities, searchCities, suggested_cities } from '../src/lib/cities';
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
      const result = searchCities(input);
      expect(result.matches[0].name).toBe(name);
      expect(result.custom_name).toBe('');
    }
  });

  test('finds results by country or by city and country together', () => {
    const japan = searchCities('japan').matches;
    expect(japan.map(({ name }) => name)).toContain('Osaka');
    expect(japan.every(({ region }) => region === 'Japan')).toBe(true);
    expect(searchCities('ky japan').matches.map(({ name }) => name)).toEqual(['Tokyo', 'Kyoto']);
  });

  test('offers trimmed custom names even when a partial directory match exists', () => {
    expect(searchCities('  Wakkanai  ')).toEqual({ matches: [], custom_name: 'Wakkanai' });
    expect(searchCities('York').custom_name).toBe('York');
    expect(searchCities('  ')).toEqual({ matches: [], custom_name: '' });
  });
});
