import { Database } from 'bun:sqlite';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  directoryKey,
  directoryShard,
  directory_shard_count,
  term_kinds,
  type AirportRow,
  type CityRow,
  type TermIndex,
} from '../src/lib/directory-format';

const sources = {
  'cities15000.zip': 'https://download.geonames.org/export/dump/cities15000.zip',
  'admin1CodesASCII.txt': 'https://download.geonames.org/export/dump/admin1CodesASCII.txt',
  'airports.csv':
    'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv',
};
const region_labels = ['en', 'zh-Hans', 'zh-Hant', 'ja'].map(
  (locale) => new Intl.DisplayNames([locale], { type: 'region' }),
);
const country_names = new Map<string, string[]>();
function countryTerms(code: string): string[] {
  const existing = country_names.get(code);
  if (existing) return existing;
  const names = [code, ...region_labels.map((labels) => labels.of(code) ?? code)];
  country_names.set(code, names);
  return names;
}
const lexical = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

type Row = CityRow | AirportRow;
interface Entry<T extends Row> {
  row: T;
  names: string[];
  aliases: string[];
  regions: string[];
  priority: number;
}

function collectCityData(directory: string, admin_names: ReadonlyMap<string, string>) {
  const data = execFileSync('unzip', ['-p', 'cities15000.zip', 'cities15000.txt'], {
    cwd: directory,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const redirects = new Map<number, number>();
  const rows: Entry<CityRow>[] = data
    .trimEnd()
    .split('\n')
    .map((line) => {
      const fields = line.split('\t');
      const [id, name, ascii, aliases, lat, lon, , , country, , admin_code, , , , population] =
        fields;
      // Column 18 is the city's IANA time zone in the GeoNames dump format.
      const time_zone = fields[17];
      const admin =
        admin_names.get(`${country}.${admin_code}`) ?? (admin_code === '00' ? '' : admin_code);
      // GeoNames labels the Japanese city "Nara-shi". Keep Fieldnotes' existing travel name.
      const duplicate = /\s+DUPLICATE OF https?:\/\/(?:www\.)?geonames\.org\/(\d+)\b/i.exec(name);
      if (duplicate) redirects.set(Number(id), Number(duplicate[1]));
      const display = id === '1855612' ? 'Nara' : name.slice(0, duplicate?.index);
      return {
        row: [Number(id), display, country, admin, Number(lat), Number(lon), time_zone],
        names: [display],
        aliases: [name, ascii, ...aliases.split(',')],
        regions: [admin, ...countryTerms(country)],
        priority: Number(population),
      };
    });
  const by_id = new Map(rows.map((entry) => [entry.row[0], entry]));
  const cities = rows.filter((entry) => {
    const target = redirects.get(entry.row[0]);
    if (!target || redirects.has(target)) return true;
    const canonical = by_id.get(target);
    if (!canonical) return true;
    canonical.aliases.push(...entry.names, ...entry.aliases);
    return false;
  });
  return { cities, source_count: rows.length };
}

interface AirportSource {
  id: string;
  name: string;
  type: string;
  ident: string;
  icao_code: string;
  iata_code: string;
  municipality: string;
  scheduled_service: string;
  iso_country: string;
  latitude_deg: string;
  longitude_deg: string;
}

function collectAirportData(directory: string): Entry<AirportRow>[] {
  // SQLite's CSV importer handles embedded commas, escaped quotes and multiline fields.
  execFileSync('sqlite3', ['source.sqlite', '.import --csv airports.csv airports'], {
    cwd: directory,
  });
  const db = new Database(join(directory, 'source.sqlite'), { readonly: true });
  try {
    const airports = db
      .query<
        AirportSource,
        []
      >("SELECT * FROM airports WHERE type <> 'closed' AND iata_code GLOB '[A-Z][A-Z][A-Z]'")
      .all();
    return airports.map((a) => ({
      row: [
        Number(a.id),
        a.name,
        a.iso_country,
        a.municipality,
        a.iata_code,
        a.icao_code,
        Number(a.latitude_deg),
        Number(a.longitude_deg),
      ],
      names: [a.iata_code, a.icao_code, a.name],
      aliases: [a.ident],
      regions: [a.municipality, ...countryTerms(a.iso_country)],
      priority:
        (a.scheduled_service === 'yes' ? 3 : 0) +
        (a.type === 'large_airport' ? 2 : Number(a.type === 'medium_airport')),
    }));
  } finally {
    db.close();
  }
}

function indexEntry<T extends Row>(entry: Entry<T>) {
  const keys = new Map<string, number>();
  const add = (term: string, kind: number) => {
    if (term && kind < (keys.get(term) ?? Infinity)) keys.set(term, kind);
  };
  function addName(value: string, kind: number) {
    // The directory contains public place names only. Exclude incidental source links and contacts.
    if (/https?:|www\.|@/i.test(value)) return;
    const key = directoryKey(value);
    add(key, kind);
    for (const word of key.split(' ')) add(word, Math.max(kind, term_kinds.word));
  }
  for (const value of entry.names) addName(value, term_kinds.name);
  for (const value of entry.aliases) addName(value, term_kinds.alias);
  for (const value of entry.regions) addName(value, term_kinds.region);
  return keys;
}

async function writeDirectory<T extends Row>(stage: string, stem: string, entries: Entry<T>[]) {
  if (!entries.length) throw new Error(`The source contains no ${stem}.`);
  const ids = new Set<number>();
  for (const { row } of entries) {
    const [id, name, country] = row;
    const coordinate_index = stem === 'cities' ? 4 : 6;
    const latitude = row[coordinate_index];
    const longitude = row[coordinate_index + 1];
    if (
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      ids.has(id) ||
      !name.trim() ||
      !/^[A-Z]{2}$/.test(country) ||
      typeof latitude !== 'number' ||
      !Number.isFinite(latitude) ||
      Math.abs(latitude) > 90 ||
      typeof longitude !== 'number' ||
      !Number.isFinite(longitude) ||
      Math.abs(longitude) > 180
    )
      throw new Error(`Invalid or duplicate ${stem} source record ${id}.`);
    ids.add(id);
  }
  entries.sort((a, b) => b.priority - a.priority || a.row[0] - b.row[0]);
  const index = new Map<string, number[]>();
  for (const [row, entry] of entries.entries()) {
    for (const [key, kind] of indexEntry(entry)) {
      const posting = row * 4 + kind;
      const list = index.get(key);
      if (list) list.push(posting);
      else index.set(key, [posting]);
    }
  }
  const shards: TermIndex[] = Array.from({ length: directory_shard_count }, () => []);
  for (const entry of [...index].sort((a, b) => lexical(a[0], b[0]))) {
    shards[directoryShard(entry[0])].push(entry);
  }
  const save = (name: string, data: unknown) =>
    writeFile(join(stage, `${name}.json.gz`), gzipSync(JSON.stringify(data), { level: 9 }));
  await save(
    stem,
    entries.map((entry) => entry.row),
  );
  for (const [id, shard] of shards.entries()) await save(`${stem}-${id}`, shard);
}

const work = await mkdtemp(join(tmpdir(), 'fieldnotes-directory-'));
const public_dir = fileURLToPath(new URL('../public/', import.meta.url));
// Keep unfinished builds out of Vite's public tree, on the same filesystem for rename.
const artifacts_dir = fileURLToPath(new URL('../artifacts/', import.meta.url));
await mkdir(artifacts_dir, { recursive: true });
const stage = await mkdtemp(join(artifacts_dir, 'directory-build-'));
const output = join(public_dir, 'directory');
const backup = join(stage, 'previous');
let keep_backup = false;
try {
  const source_files = [];
  for (const [name, url] of Object.entries(sources)) {
    const path = join(work, name);
    if (process.argv[2]) await cp(join(resolve(process.argv[2]), name), path);
    else {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not fetch ${name} (HTTP ${response.status}).`);
      await Bun.write(path, await response.arrayBuffer());
    }
    source_files.push({
      name,
      url,
      sha256: createHash('sha256')
        .update(await readFile(path))
        .digest('hex'),
    });
  }
  const admin_names = new Map(
    (await readFile(join(work, 'admin1CodesASCII.txt'), 'utf8'))
      .trimEnd()
      .split('\n')
      .map((line) => {
        const [key, name] = line.split('\t');
        return [key, name] as const;
      }),
  );
  const { cities, source_count } = collectCityData(work, admin_names);
  const airports = collectAirportData(work);
  const next = join(stage, 'next');
  await mkdir(next);
  await writeDirectory(next, 'cities', cities);
  await writeDirectory(next, 'airports', airports);
  const manifest = {
    format_version: 2,
    source_city_count: source_count,
    city_count: cities.length,
    airport_count: airports.length,
    adaptation:
      'Selected public place fields and IANA city time zones, normalized names and built offline search indexes.',
    sources: source_files,
    attribution: [
      {
        name: 'GeoNames',
        url: 'https://www.geonames.org/',
        license: 'CC BY 4.0',
        license_url: 'https://creativecommons.org/licenses/by/4.0/',
      },
      { name: 'OurAirports', url: 'https://ourairports.com/data/', license: 'Public domain' },
    ],
  };
  await writeFile(join(next, 'sources.json'), JSON.stringify(manifest, null, 2) + '\n');
  try {
    await rename(output, backup);
    keep_backup = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  try {
    await rename(next, output);
  } catch (error) {
    if (keep_backup) {
      try {
        await rename(backup, output);
        keep_backup = false;
      } catch (restore_error) {
        throw new AggregateError(
          [error, restore_error],
          `Could not restore the previous directory. Its intact files are in ${backup}`,
        );
      }
    }
    throw error;
  }
  keep_backup = false;
  console.log(`Built offline search for ${cities.length} cities and ${airports.length} airports.`);
} finally {
  await rm(work, { recursive: true, force: true });
  if (!keep_backup) await rm(stage, { recursive: true, force: true });
}
