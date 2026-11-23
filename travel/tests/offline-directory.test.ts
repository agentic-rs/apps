import { expect, test } from 'bun:test';
import { gunzipSync } from 'node:zlib';
import { createOfflineDirectory } from '../src/lib/offline-directory';
import { directoryKey, type AirportRow, type CityRow } from '../src/lib/directory-format';

const assets = new URL('../public/directory/', import.meta.url);
async function readAsset(path: string) {
  const bytes = await Bun.file(new URL(path + '.json.gz', assets)).bytes();
  return JSON.parse(gunzipSync(bytes).toString('utf8'));
}

const directory = createOfflineDirectory(readAsset);

test('the shipped records match the source manifest and have distinct public place IDs', async () => {
  const manifest = await Bun.file(new URL('sources.json', assets)).json();
  const cities: CityRow[] = await readAsset('cities');
  const airports: AirportRow[] = await readAsset('airports');
  expect(cities).toHaveLength(manifest.city_count);
  expect(airports).toHaveLength(manifest.airport_count);
  expect(new Set(cities.map(([id]) => id)).size).toBe(cities.length);
  expect(cities.every((row) => typeof row[6] === 'string' && row[6].length > 0)).toBe(true);
  expect(new Set(airports.map(([id]) => id)).size).toBe(airports.length);
  expect(airports.every((row) => /^[A-Z]{3}$/.test(row[4]))).toBe(true);
});

test('multilingual city names resolve to the same location and retain exact matches', async () => {
  for (const query of ['京都', 'Kyoto', 'Kyōto']) {
    const [city] = await directory.searchDirectoryCities(query);
    expect(city).toMatchObject({
      id: 'geonames:1857910',
      name: 'Kyoto',
      country_code: 'JP',
      exact_match: true,
    });
    expect(city.latitude).toBeCloseTo(35, 0);
  }
  const [nara] = await directory.searchDirectoryCities('Nara');
  expect(nara).toMatchObject({ id: 'geonames:1855612', name: 'Nara', country_code: 'JP' });
  expect((await directory.searchDirectoryCities('京都 日本'))[0].id).toBe('geonames:1857910');
  expect(directoryKey('São Paulo')).toBe('sao paulo');
});

test('a publisher-marked duplicate keeps its alternate name on the canonical city', async () => {
  const results = await directory.searchDirectoryCities('Redford CDP');
  expect(results.filter((city) => city.exact_match).map((city) => city.id)).toEqual([
    'geonames:5006917',
  ]);
  expect(results[0].name).toBe('Redford');
});

test('same-name cities retain distinct IDs, states and coordinates', async () => {
  const cities = await directory.searchDirectoryCities('Springfield US');
  const springfields = cities.filter(
    (city) => city.name === 'Springfield' && city.country_code === 'US',
  );
  expect(springfields.map((c) => c.admin1)).toContain('Illinois');
  expect(springfields.map((c) => c.admin1)).toContain('Massachusetts');
  expect(new Set(springfields.map((c) => c.id)).size).toBe(springfields.length);
  const cities_by_id = await directory.getDirectoryCitiesById([
    'geonames:1880252',
    'geonames:1857910',
  ]);
  expect(cities_by_id.map((city) => city.name)).toEqual(['Singapore', 'Kyoto']);
});

test('city time zones use saved IDs and distinguish older namesakes by their stop pin', async () => {
  expect(await directory.resolveCityTimeZone('custom label', 'geonames:1857910')).toBe(
    'Asia/Tokyo',
  );
  expect(await directory.resolveCityTimeZone('Singapore', 'geonames:1')).toBeUndefined();
  expect(await directory.resolveCityTimeZone('京都')).toBe('Asia/Tokyo');
  expect(await directory.resolveCityTimeZone('Singapore')).toBe('Asia/Singapore');
  expect(await directory.resolveCityTimeZone('Kathmandu')).toBe('Asia/Kathmandu');
  expect(await directory.resolveCityTimeZone('Kathm')).toBeUndefined();
  expect(await directory.resolveCityTimeZone('Nara')).toBeUndefined();
  expect(
    await directory.resolveCityTimeZone('Nara', undefined, { latitude: 34.68, longitude: 135.8 }),
  ).toBe('Asia/Tokyo');
  expect(
    await directory.resolveCityTimeZone('Springfield', undefined, {
      latitude: 42.1,
      longitude: -72.59,
    }),
  ).toBe('America/New_York');
  expect(
    await directory.resolveCityTimeZone('Springfield', undefined, { latitude: 0, longitude: 0 }),
  ).toBeUndefined();
});

test('time zone agreement includes candidates beyond the picker limit', async () => {
  const rows: CityRow[] = Array.from({ length: 41 }, (_, index) => [
    index + 1,
    'Town',
    'US',
    '',
    39,
    -90,
    index < 40 ? 'America/Chicago' : 'America/New_York',
  ]);
  const lookup = createOfflineDirectory(async (path) =>
    path === 'cities' ? rows : [['town', rows.map((_, index) => index * 4)]],
  );
  expect((await lookup.searchDirectoryCities('town')).length).toBe(40);
  expect(await lookup.resolveCityTimeZone('town')).toBeUndefined();
  rows[40][6] = 'America/Chicago';
  expect(await lookup.resolveCityTimeZone('town')).toBe('America/Chicago');
});

test('airports support IATA and ICAO codes, municipality, and name words', async () => {
  const [kix] = await directory.searchDirectoryAirports('kix');
  const [rjbb] = await directory.searchDirectoryAirports('RJBB');
  expect(kix).toMatchObject({
    id: 'ourairports:5536',
    name: 'Kansai International Airport',
    iata_code: 'KIX',
    icao_code: 'RJBB',
    exact_match: true,
  });
  expect(rjbb.id).toBe(kix.id);
  expect((await directory.searchDirectoryAirports('osaka')).map((a) => a.id)).toContain(kix.id);
  const [lhr] = await directory.searchDirectoryAirports('london heathrow');
  expect(lhr.iata_code).toBe('LHR');
});

test('empty queries read no assets, and a failed shard can be retried', async () => {
  const reads: string[] = [];
  let fail = true;
  const lookup = createOfflineDirectory(async (path) => {
    reads.push(path);
    if (path.startsWith('cities-') && fail) throw new Error('Interrupted package read');
    return readAsset(path);
  });
  expect(await lookup.searchDirectoryCities('  ')).toEqual([]);
  expect(reads).toEqual([]);
  await expect(lookup.searchDirectoryCities('Kyoto')).rejects.toThrow('Interrupted package read');
  fail = false;
  expect((await lookup.searchDirectoryCities('Kyoto'))[0].name).toBe('Kyoto');
  expect(reads.filter((p) => p === 'cities')).toHaveLength(1);
});
