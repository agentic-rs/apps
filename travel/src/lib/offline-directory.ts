import {
  directoryKey,
  directoryShard,
  term_kinds,
  type AirportRow,
  type CityRow,
  type TermIndex,
} from './directory-format';
import { distanceKm } from './distance';
import { placeSearchRadiusKm } from './place-providers';
import type { Coordinates } from './types';

interface DirectoryPlace {
  id: string;
  name: string;
  country_code: string;
  latitude: number;
  longitude: number;
  exact_match: boolean;
}

export interface DirectoryCity extends DirectoryPlace {
  admin1: string;
  time_zone?: string;
}

export interface DirectoryAirport extends DirectoryPlace {
  municipality: string;
  iata_code: string;
  icao_code: string;
}

type Directory = 'cities' | 'airports';
const max_results = 40;

async function readPackageFile(path: string): Promise<unknown> {
  const response = await fetch(new URL(`directory/${path}.json.gz`, document.baseURI));
  if (!response.ok || !response.body)
    throw new Error('Could not read the offline place directory.');
  const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).json();
}

/** Sorted at build time using the same UTF-16 ordering as this lower-bound search. */
function firstTerm(index: TermIndex, query: string): number {
  let low = 0;
  let high = index.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (index[middle][0] < query) low = middle + 1;
    else high = middle;
  }
  return low;
}

function prefixMatches(index: TermIndex, query: string): Map<number, number> {
  const matches = new Map<number, number>();
  for (let i = firstTerm(index, query); i < index.length; i++) {
    const [key, postings] = index[i];
    if (!key.startsWith(query)) break;
    for (const posting of postings) {
      const row = Math.floor(posting / 4);
      const kind = posting % 4;
      const prefix = key !== query;
      // Exact names and aliases outrank any prefix, then name words, then regions.
      const score = kind >= term_kinds.word ? kind * 2 + Number(prefix) : kind + (prefix ? 2 : 0);
      if (score < (matches.get(row) ?? Infinity)) matches.set(row, score);
    }
  }
  return matches;
}

function cityFromRow(
  [id, name, country_code, admin1, latitude, longitude, time_zone]: CityRow,
  exact_match: boolean,
): DirectoryCity {
  return {
    id: `geonames:${id}`,
    name,
    country_code,
    admin1,
    latitude,
    longitude,
    exact_match,
    time_zone: time_zone || undefined,
  };
}

/** Both browser and Apell read the same prebuilt index from their own package. */
export function createOfflineDirectory(read = readPackageFile) {
  const records = new Map<Directory, Promise<unknown>>();
  const shards = new Map<string, Promise<TermIndex>>();

  function getRecords<T>(directory: Directory): Promise<T[]> {
    const existing = records.get(directory);
    if (existing) return existing as Promise<T[]>;
    const promise = read(directory).catch((reason) => {
      records.delete(directory);
      throw reason;
    });
    records.set(directory, promise);
    return promise as Promise<T[]>;
  }

  function getShard(directory: Directory, term: string): Promise<TermIndex> {
    const path = `${directory}-${directoryShard(term)}`;
    const existing = shards.get(path);
    if (existing) {
      shards.delete(path);
      shards.set(path, existing);
      return existing;
    }
    const promise = (read(path) as Promise<TermIndex>).catch((reason) => {
      if (shards.get(path) === promise) shards.delete(path);
      throw reason;
    });
    shards.set(path, promise);
    if (shards.size > 12) shards.delete(shards.keys().next().value!);
    return promise;
  }

  async function search(directory: Directory, query: string) {
    const phrase = directoryKey(query);
    if (!phrase) return [];
    const words = [...new Set(phrase.split(' '))];
    const keys = words.length === 1 ? words : [...words, phrase];
    const sets = await Promise.all(
      keys.map(async (key) => prefixMatches(await getShard(directory, key), key)),
    );
    const phrases = sets[sets.length - 1];
    const word_sets = sets.slice(0, words.length).sort((a, b) => a.size - b.size);
    const results: { row: number; score: number; exact_match: boolean }[] = [];
    for (const row of word_sets[0].keys()) {
      if (!word_sets.every((set) => set.has(row))) continue;
      const phrase_score = phrases.get(row);
      const score = phrase_score ?? word_sets.reduce((sum, set) => sum + set.get(row)!, 8);
      results.push({ row, score, exact_match: phrase_score !== undefined && phrase_score < 2 });
    }
    results.sort((a, b) => a.score - b.score || a.row - b.row);
    return results.slice(0, max_results);
  }

  async function getDirectoryCitiesById(ids: readonly string[]): Promise<DirectoryCity[]> {
    if (!ids.length) return [];
    const rows = await getRecords<CityRow>('cities');
    const wanted = new Set(ids);
    const found = new Map<string, DirectoryCity>();
    for (const row of rows) {
      const id = `geonames:${row[0]}`;
      if (wanted.has(id)) found.set(id, cityFromRow(row, true));
      if (wanted.size === found.size) break;
    }
    return ids.flatMap((id) => found.get(id) ?? []);
  }

  return {
    async searchDirectoryCities(query: string): Promise<DirectoryCity[]> {
      if (!directoryKey(query)) return [];
      const [rows, matches] = await Promise.all([
        getRecords<CityRow>('cities'),
        search('cities', query),
      ]);
      return matches.map(({ row, exact_match }) => cityFromRow(rows[row], exact_match));
    },
    getDirectoryCitiesById,
    async resolveCityTimeZone(
      city_name: string,
      city_id?: string,
      position?: Coordinates | null,
    ): Promise<string | undefined> {
      if (city_id !== undefined) return (await getDirectoryCitiesById([city_id]))[0]?.time_zone;
      const key = directoryKey(city_name);
      if (!key) return undefined;
      const index = await getShard('cities', key);
      const term = index[firstTerm(index, key)];
      if (!term || term[0] !== key) return undefined;
      // Every exact name and alias matters, including records beyond the picker result limit.
      const rows = await getRecords<CityRow>('cities');
      const candidates = term[1]
        .filter((posting) => posting % 4 <= term_kinds.alias)
        .map((posting) => cityFromRow(rows[Math.floor(posting / 4)], true));
      const nearby =
        position &&
        candidates.filter((city) => distanceKm(position, city) <= placeSearchRadiusKm(''));
      const zones = new Set((nearby?.length ? nearby : candidates).map((city) => city.time_zone));
      return zones.size === 1 ? zones.values().next().value : undefined;
    },
    async searchDirectoryAirports(query: string): Promise<DirectoryAirport[]> {
      if (!directoryKey(query)) return [];
      const [rows, matches] = await Promise.all([
        getRecords<AirportRow>('airports'),
        search('airports', query),
      ]);
      return matches.map(({ row, exact_match }) => {
        const [id, name, country_code, municipality, iata_code, icao_code, latitude, longitude] =
          rows[row];
        return {
          id: `ourairports:${id}`,
          name,
          country_code,
          municipality,
          iata_code,
          icao_code,
          latitude,
          longitude,
          exact_match,
        };
      });
    },
  };
}

export const {
  searchDirectoryCities,
  getDirectoryCitiesById,
  searchDirectoryAirports,
  resolveCityTimeZone,
} = createOfflineDirectory();
