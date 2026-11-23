/** Each index entry points to a row in the same release's records file. */
export type CityRow = [
  id: number,
  name: string,
  country_code: string,
  admin1: string,
  latitude: number,
  longitude: number,
  time_zone: string,
];

export type AirportRow = [
  id: number,
  name: string,
  country_code: string,
  municipality: string,
  iata_code: string,
  icao_code: string,
  latitude: number,
  longitude: number,
];

/** The low two bits distinguish a name, alternate name, name word or region. */
export type TermIndex = [key: string, postings: number[]][];
export const term_kinds = { name: 0, alias: 1, word: 2, region: 3 } as const;
export const directory_shard_count = 32;

export function directoryKey(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/(\p{Script=Latin})\p{M}+/gu, '$1')
    .replace(/['’ʼ]/gu, '')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();
}

export function directoryShard(key: string): number {
  return key.codePointAt(0)! % directory_shard_count;
}
