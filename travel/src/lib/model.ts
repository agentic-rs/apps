import { isCalendarDate, isUtcTimestamp, toVisitInput, validateOffset } from './dates';
import { parseExpenses } from './expenses';
import { journal_schema_version, stop_kinds } from './types';
import type {
  CheckIn,
  Coordinates,
  DirectoryRef,
  Journal,
  PackingItem,
  PhotoAsset,
  Place,
  PlannedStop,
  Trip,
  TripCityLocation,
  VisitLocation,
} from './types';

export const max_photo_bytes = 32 * 1_024 * 1_024;
export const max_photos_per_check_in = 20;
export const text_limits = {
  trip_title: 200,
  trip_description: 10_000,
  city_name: 120,
  packing_title: 200,
  stop_title: 200,
  stop_notes: 20_000,
  place_name: 200,
  place_locality: 300,
  check_in_title: 200,
  check_in_notes: 20_000,
} as const;
export const supported_image_types = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/avif',
] as const;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max_length: number, required = false): string {
  if (typeof value !== 'string' || value.length > max_length || (required && !value.trim())) {
    throw new Error(
      `${label} must be ${required ? 'nonempty and ' : ''}at most ${max_length} characters.`,
    );
  }
  return value;
}

function id(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) {
    throw new Error(`${label} has an invalid identity.`);
  }
  return value;
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isUtcTimestamp(value)) {
    throw new Error(`${label} must be a valid UTC timestamp.`);
  }
  return new Date(value).toISOString();
}

function date(value: unknown, label: string): string {
  if (typeof value !== 'string' || (value !== '' && !isCalendarDate(value))) {
    throw new Error(`${label} must be a valid date.`);
  }
  return value;
}

export function parseCoordinates(value: unknown): Coordinates {
  const row = record(value, 'Coordinates');
  if (
    typeof row.latitude !== 'number' ||
    !Number.isFinite(row.latitude) ||
    row.latitude < -90 ||
    row.latitude > 90 ||
    typeof row.longitude !== 'number' ||
    !Number.isFinite(row.longitude) ||
    row.longitude < -180 ||
    row.longitude > 180
  ) {
    throw new Error('Latitude must be between −90 and 90; longitude must be between −180 and 180.');
  }
  return { latitude: row.latitude, longitude: row.longitude };
}

export function readCoordinates(latitude: string, longitude: string): Coordinates | null {
  if (!latitude.trim() && !longitude.trim()) return null;
  if (!latitude.trim() || !longitude.trim())
    throw new Error('Enter both latitude and longitude, or leave both blank.');
  return parseCoordinates({ latitude: Number(latitude), longitude: Number(longitude) });
}

export function parseVisitLocation(value: unknown): VisitLocation {
  const row = record(value, 'Visit location');
  const position = parseCoordinates(row);
  if (
    row.accuracy_m !== null &&
    (typeof row.accuracy_m !== 'number' || !Number.isFinite(row.accuracy_m) || row.accuracy_m < 0)
  ) {
    throw new Error('Location accuracy is invalid.');
  }
  if (row.source !== 'device' && row.source !== 'manual' && row.source !== 'photo') {
    throw new Error('Location source is invalid.');
  }
  return {
    ...position,
    accuracy_m: row.accuracy_m,
    source: row.source,
    captured_at:
      row.captured_at === null ? null : timestamp(row.captured_at, 'Location capture time'),
  };
}

function parseTripCityLocation(value: unknown): TripCityLocation | null {
  if (value === null) return null;
  const row = record(value, 'City location');
  if (typeof row.id !== 'string' || !/^geonames:\d+$/.test(row.id))
    throw new Error('Invalid GeoNames city identifier.');
  if (typeof row.country_code !== 'string' || !/^[A-Z]{2}$/.test(row.country_code))
    throw new Error('Invalid city country code.');
  return { id: row.id, country_code: row.country_code, ...parseCoordinates(row) };
}

export function parseTrip(value: unknown): Trip {
  const row = record(value, 'Trip');
  const start_date = date(row.start_date, 'Trip start');
  const end_date = date(row.end_date, 'Trip end');
  if (start_date && end_date && end_date < start_date) {
    throw new Error('The trip end date must be on or after its start date.');
  }
  const packing_items =
    row.packing_items === undefined
      ? undefined
      : rows(row.packing_items, 'Packing items', parsePackingItem);
  if (packing_items) unique(packing_items, (item) => item.id, 'Packing items');
  const cities =
    row.cities === undefined
      ? undefined
      : rows(row.cities, 'Trip cities', (city) =>
          text(city, 'City name', text_limits.city_name, true).trim(),
        );
  if (cities?.length === 0) throw new Error('Choose a starting city.');
  const city_locations =
    row.city_locations === undefined
      ? undefined
      : rows(row.city_locations, 'City locations', parseTripCityLocation);
  if (city_locations && city_locations.length !== cities?.length)
    throw new Error('City locations must match the trip’s cities.');
  const city_arrival_dates =
    row.city_arrival_dates === undefined
      ? undefined
      : rows(row.city_arrival_dates, 'City arrival dates', (value) => date(value, 'City arrival'));
  if (city_arrival_dates) {
    if (!cities || city_arrival_dates.length !== cities.length)
      throw new Error('The arrival dates must match the trip’s cities.');
    if (city_arrival_dates[0] !== '') throw new Error('The starting city has no transfer date.');
    let previous = start_date;
    for (const arrival of city_arrival_dates) {
      if (!arrival) continue;
      if ((start_date && arrival < start_date) || (end_date && arrival > end_date))
        throw new Error('Choose an arrival date within the trip dates.');
      if (arrival < previous)
        throw new Error('City arrival dates must follow the order of the route.');
      previous = arrival;
    }
  }
  return {
    id: id(row.id, 'Trip'),
    title: text(row.title, 'Trip title', text_limits.trip_title, true).trim(),
    description: text(row.description, 'Trip description', text_limits.trip_description),
    ...(cities !== undefined && { cities }),
    ...(city_locations?.some(Boolean) && { city_locations }),
    ...(city_arrival_dates?.some(Boolean) && { city_arrival_dates }),
    start_date,
    end_date,
    ...(packing_items !== undefined && { packing_items }),
    ...(row.expenses !== undefined && { expenses: parseExpenses(row.expenses) }),
    created_at: timestamp(row.created_at, 'Trip creation time'),
    updated_at: timestamp(row.updated_at, 'Trip update time'),
  };
}

function parsePackingItem(value: unknown): PackingItem {
  const row = record(value, 'Packing item');
  if (typeof row.packed !== 'boolean') throw new Error('The packing item status is invalid.');
  return {
    id: id(row.id, 'Packing item'),
    title: text(row.title, 'Packing item name', text_limits.packing_title, true).trim(),
    packed: row.packed,
  };
}

export function parsePlace(value: unknown): Place {
  const row = record(value, 'Place');
  return {
    id: id(row.id, 'Place'),
    name: text(row.name, 'Place name', text_limits.place_name, true).trim(),
    locality: text(row.locality, 'Place locality', text_limits.place_locality).trim(),
    position: row.position === null ? null : parseCoordinates(row.position),
    created_at: timestamp(row.created_at, 'Place creation time'),
    updated_at: timestamp(row.updated_at, 'Place update time'),
  };
}

function parseDirectoryRef(value: unknown): DirectoryRef {
  const row = record(value, 'Place source');
  if (row.provider !== 'ourairports' && row.provider !== 'osm' && row.provider !== 'geoapify')
    throw new Error('Unrecognized place source.');
  return {
    provider: row.provider,
    id: text(row.id, 'Place source ID', 512, true),
    ...(row.subtitle !== undefined && {
      subtitle: text(row.subtitle, 'Place description', text_limits.place_locality),
    }),
  };
}

export function parseStop(value: unknown): PlannedStop {
  const row = record(value, 'Planned stop');
  if (typeof row.day !== 'string' || !isCalendarDate(row.day))
    throw new Error('Choose a valid date for the stop.');
  if (
    typeof row.time !== 'string' ||
    (row.time !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.time))
  )
    throw new Error('Enter a valid stop time or leave the time blank.');
  const kind = stop_kinds.find((option) => option === row.kind);
  if (!kind) throw new Error('Choose a valid stop category.');
  const checkout = row.checkout_date;
  if (
    checkout !== undefined &&
    (kind !== 'stay' ||
      typeof checkout !== 'string' ||
      !isCalendarDate(checkout) ||
      checkout <= row.day)
  )
    throw new Error('Choose a check-out date after the check-in date for this stay.');
  return {
    id: id(row.id, 'Planned stop'),
    trip_id: id(row.trip_id, 'Trip'),
    day: row.day,
    ...(checkout !== undefined && { checkout_date: checkout }),
    title: text(row.title, 'Stop title', text_limits.stop_title, true).trim(),
    kind,
    ...(row.directory_ref !== undefined && { directory_ref: parseDirectoryRef(row.directory_ref) }),
    time: row.time,
    notes: text(row.notes, 'Stop notes', text_limits.stop_notes),
    position: row.position === null ? null : parseCoordinates(row.position),
  };
}

export function isSafePhotoPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^images\/[a-zA-Z0-9_-]{1,100}\.(?:jpe?g|png|gif|webp|heic|heif|avif)$/i.test(value)
  );
}

export function parsePhotoAsset(value: unknown): PhotoAsset {
  const row = record(value, 'Photo');
  if (!isSafePhotoPath(row.path)) throw new Error('The photo storage path is invalid.');
  if (
    typeof row.mime_type !== 'string' ||
    !(supported_image_types as readonly string[]).includes(row.mime_type)
  ) {
    throw new Error('Choose a JPEG, PNG, GIF, WebP, HEIC, HEIF, or AVIF image.');
  }
  if (
    typeof row.size_bytes !== 'number' ||
    !Number.isSafeInteger(row.size_bytes) ||
    row.size_bytes <= 0 ||
    row.size_bytes > max_photo_bytes
  ) {
    throw new Error('Each photo must contain image data and be no larger than 32 MiB.');
  }
  return {
    id: id(row.id, 'Photo'),
    path: row.path,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
  };
}

function rows<T>(value: unknown, label: string, parse: (row: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be a list.`);
  return value.map(parse);
}

function unique<T>(values: T[], key: (row: T) => string, label: string): void {
  const seen = new Set<string>();
  for (const row of values) {
    const value = key(row);
    if (seen.has(value)) throw new Error(`${label} contains a duplicate identity.`);
    seen.add(value);
  }
}

export function parseCheckIn(value: unknown): CheckIn {
  const row = record(value, 'Check-in');
  const photos = rows(row.photos, 'Photos', parsePhotoAsset);
  if (photos.length > max_photos_per_check_in)
    throw new Error('A check-in can have up to 20 photos.');
  unique(photos, (photo) => photo.id, 'Photos');
  unique(photos, (photo) => photo.path, 'Photo storage');
  if (typeof row.utc_offset_minutes !== 'number')
    throw new Error('The visit time zone is invalid.');
  const visited_at = timestamp(row.visited_at, 'Visit time');
  const utc_offset_minutes = validateOffset(row.utc_offset_minutes);
  toVisitInput(visited_at, utc_offset_minutes);
  const title =
    row.title === undefined
      ? ''
      : text(row.title, 'Event title', text_limits.check_in_title).trim();
  const place_id = row.place_id === null ? null : id(row.place_id, 'Place');
  if (!place_id && !title) throw new Error('Enter an event title or choose a named place.');
  return {
    id: id(row.id, 'Check-in'),
    trip_id: id(row.trip_id, 'Trip'),
    ...(row.stop_id !== undefined && { stop_id: id(row.stop_id, 'Planned stop') }),
    place_id,
    ...(title && { title }),
    visited_at,
    utc_offset_minutes,
    actual_location: row.actual_location === null ? null : parseVisitLocation(row.actual_location),
    notes: text(row.notes, 'Check-in notes', text_limits.check_in_notes),
    photos,
    created_at: timestamp(row.created_at, 'Check-in creation time'),
    updated_at: timestamp(row.updated_at, 'Check-in update time'),
  };
}

export function emptyJournal(): Journal {
  return {
    schema_version: journal_schema_version,
    trips: [],
    stops: [],
    places: [],
    check_ins: [],
  };
}

export function parseJournal(value: unknown): Journal {
  const row = record(value, 'Journal');
  if (
    typeof row.schema_version !== 'number' ||
    !Number.isInteger(row.schema_version) ||
    row.schema_version < 1 ||
    row.schema_version > journal_schema_version
  )
    throw new Error('This journal version is not supported.');
  const trips = rows(row.trips, 'Trips', parseTrip);
  const stops =
    row.schema_version === 1 && row.stops === undefined
      ? []
      : rows(row.stops, 'Planned stops', parseStop);
  const places = rows(row.places, 'Places', parsePlace);
  const check_ins = rows(row.check_ins, 'Check-ins', parseCheckIn);
  unique(trips, (trip) => trip.id, 'Trips');
  unique(stops, (stop) => stop.id, 'Planned stops');
  unique(places, (place) => place.id, 'Places');
  unique(check_ins, (check_in) => check_in.id, 'Check-ins');
  const trip_ids = new Set(trips.map((trip) => trip.id));
  const stop_trips = new Map(stops.map((stop) => [stop.id, stop.trip_id]));
  const place_ids = new Set(places.map((place) => place.id));
  for (const stop of stops) {
    if (!trip_ids.has(stop.trip_id)) throw new Error('A planned stop refers to a missing trip.');
  }
  for (const check_in of check_ins) {
    if (!trip_ids.has(check_in.trip_id)) throw new Error('A check-in refers to a missing trip.');
    if (check_in.place_id !== null && !place_ids.has(check_in.place_id))
      throw new Error('A check-in refers to a missing place.');
    if (check_in.stop_id && stop_trips.get(check_in.stop_id) !== check_in.trip_id)
      throw new Error('Choose a planned stop from the same trip as the check-in.');
  }
  const photos = check_ins.flatMap((check_in) => check_in.photos);
  unique(photos, (photo) => photo.id, 'Journal photos');
  unique(photos, (photo) => photo.path, 'Journal photo storage');
  return { schema_version: journal_schema_version, trips, stops, places, check_ins };
}

function upsert<T extends { id: string }>(values: T[], value: T): T[] {
  return values.some((row) => row.id === value.id)
    ? values.map((row) => (row.id === value.id ? value : row))
    : [...values, value];
}

export function upsertTrip(journal: Journal, value: Trip): Journal {
  // Editors may omit fields outside their scope. Merge with the latest saved trip.
  const existing = journal.trips.find((trip) => trip.id === value.id);
  const cities = value.cities === undefined ? existing?.cities : value.cities;
  if (!existing && !cities) throw new Error('Choose a starting city.');
  const trip = parseTrip({ ...existing, ...value, cities });
  return parseJournal({ ...journal, trips: upsert(journal.trips, trip) });
}

function sameRouteDay(first: PlannedStop, second: PlannedStop): boolean {
  return first.trip_id === second.trip_id && first.day === second.day;
}

export function upsertStop(journal: Journal, value: PlannedStop): Journal {
  const stop = parseStop(value);
  const previous = journal.stops.find((row) => row.id === stop.id);
  const stops =
    previous && !sameRouteDay(previous, stop)
      ? [...journal.stops.filter((row) => row.id !== stop.id), stop]
      : upsert(journal.stops, stop);
  return parseJournal({ ...journal, stops });
}

export function removeStop(journal: Journal, stop_id: string): Journal {
  id(stop_id, 'Planned stop');
  const check_ins = journal.check_ins.map((check_in) => {
    if (check_in.stop_id !== stop_id) return check_in;
    const { stop_id: removed, ...visit } = check_in;
    return visit;
  });
  return parseJournal({
    ...journal,
    stops: journal.stops.filter((stop) => stop.id !== stop_id),
    check_ins,
  });
}

export function moveStop(journal: Journal, stop_id: string, direction: -1 | 1): Journal {
  if (direction !== -1 && direction !== 1) throw new Error('Move the stop one position at a time.');
  const stops = [...journal.stops];
  const index = stops.findIndex((row) => row.id === stop_id);
  if (index === -1) throw new Error('The planned stop could not be found.');
  for (let next = index + direction; next >= 0 && next < stops.length; next += direction) {
    if (!sameRouteDay(stops[index], stops[next])) continue;
    [stops[index], stops[next]] = [stops[next], stops[index]];
    return { ...journal, stops };
  }
  return journal;
}

/** The place and the visit enter the journal together, so neither can leave a dangling reference. */
export function saveCheckIn(journal: Journal, value: CheckIn, place_value: Place | null): Journal {
  const check_in = parseCheckIn(value);
  const place = place_value === null ? null : parsePlace(place_value);
  if (check_in.place_id !== (place?.id ?? null))
    throw new Error('Choose the place linked to this check-in.');
  return parseJournal({
    ...journal,
    places: place ? upsert(journal.places, place) : journal.places,
    check_ins: upsert(journal.check_ins, check_in),
  });
}

export function visitTitle(visit: CheckIn, place?: Place): string {
  return visit.title || place?.name || 'Check-in';
}

export function formatEntryCount(count: number): string {
  return `${count} ${count === 1 ? 'entry' : 'entries'}`;
}

export function addPhotoEvents(journal: Journal, events: CheckIn[]): Journal {
  return parseJournal({ ...journal, check_ins: [...journal.check_ins, ...events] });
}

export function removeCheckIn(journal: Journal, check_in_id: string): Journal {
  id(check_in_id, 'Check-in');
  return parseJournal({
    ...journal,
    check_ins: journal.check_ins.filter((row) => row.id !== check_in_id),
  });
}

export function removeTrip(journal: Journal, trip_id: string): Journal {
  id(trip_id, 'Trip');
  return parseJournal({
    ...journal,
    trips: journal.trips.filter((row) => row.id !== trip_id),
    stops: journal.stops.filter((row) => row.trip_id !== trip_id),
    check_ins: journal.check_ins.filter((row) => row.trip_id !== trip_id),
  });
}

export function formatCoordinates(value: Coordinates): string {
  const position = parseCoordinates(value);
  return `${position.latitude.toFixed(5)}, ${position.longitude.toFixed(5)}`;
}
