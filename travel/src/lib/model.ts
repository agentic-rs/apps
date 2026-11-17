import { isCalendarDate, isUtcTimestamp, toVisitInput, validateOffset } from './dates';
import type {
  CheckIn,
  Coordinates,
  Journal,
  PhotoAsset,
  Place,
  Trip,
  VisitLocation,
} from './types';

export const max_photo_bytes = 32 * 1_024 * 1_024;
export const max_photos_per_check_in = 20;
export const text_limits = {
  trip_title: 200,
  trip_description: 10_000,
  place_name: 200,
  place_locality: 300,
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

export function parseVisitLocation(value: unknown): VisitLocation {
  const row = record(value, 'Visit location');
  const position = parseCoordinates(row);
  if (
    row.accuracy_m !== null &&
    (typeof row.accuracy_m !== 'number' || !Number.isFinite(row.accuracy_m) || row.accuracy_m < 0)
  ) {
    throw new Error('Location accuracy is invalid.');
  }
  if (row.source !== 'device' && row.source !== 'manual') {
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

export function parseTrip(value: unknown): Trip {
  const row = record(value, 'Trip');
  const start_date = date(row.start_date, 'Trip start');
  const end_date = date(row.end_date, 'Trip end');
  if (start_date && end_date && end_date < start_date) {
    throw new Error('The trip end date must be on or after its start date.');
  }
  return {
    id: id(row.id, 'Trip'),
    title: text(row.title, 'Trip title', text_limits.trip_title, true).trim(),
    description: text(row.description, 'Trip description', text_limits.trip_description),
    start_date,
    end_date,
    created_at: timestamp(row.created_at, 'Trip creation time'),
    updated_at: timestamp(row.updated_at, 'Trip update time'),
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
  return {
    id: id(row.id, 'Check-in'),
    trip_id: id(row.trip_id, 'Trip'),
    place_id: id(row.place_id, 'Place'),
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
  return { schema_version: 1, trips: [], places: [], check_ins: [] };
}

export function parseJournal(value: unknown): Journal {
  const row = record(value, 'Journal');
  if (row.schema_version !== 1) throw new Error('This journal version is not supported.');
  const trips = rows(row.trips, 'Trips', parseTrip);
  const places = rows(row.places, 'Places', parsePlace);
  const check_ins = rows(row.check_ins, 'Check-ins', parseCheckIn);
  unique(trips, (trip) => trip.id, 'Trips');
  unique(places, (place) => place.id, 'Places');
  unique(check_ins, (check_in) => check_in.id, 'Check-ins');
  const trip_ids = new Set(trips.map((trip) => trip.id));
  const place_ids = new Set(places.map((place) => place.id));
  for (const check_in of check_ins) {
    if (!trip_ids.has(check_in.trip_id)) throw new Error('A check-in refers to a missing trip.');
    if (!place_ids.has(check_in.place_id)) throw new Error('A check-in refers to a missing place.');
  }
  const photos = check_ins.flatMap((check_in) => check_in.photos);
  unique(photos, (photo) => photo.id, 'Journal photos');
  unique(photos, (photo) => photo.path, 'Journal photo storage');
  return { schema_version: 1, trips, places, check_ins };
}

function upsert<T extends { id: string }>(values: T[], value: T): T[] {
  return values.some((row) => row.id === value.id)
    ? values.map((row) => (row.id === value.id ? value : row))
    : [...values, value];
}

export function upsertTrip(journal: Journal, value: Trip): Journal {
  const trip = parseTrip(value);
  return parseJournal({ ...journal, trips: upsert(journal.trips, trip) });
}

/** The place and the visit enter the journal together, so neither can leave a dangling reference. */
export function saveCheckIn(journal: Journal, value: CheckIn, place_value: Place): Journal {
  const check_in = parseCheckIn(value);
  const place = parsePlace(place_value);
  if (check_in.place_id !== place.id) throw new Error('Choose the place linked to this check-in.');
  return parseJournal({
    ...journal,
    places: upsert(journal.places, place),
    check_ins: upsert(journal.check_ins, check_in),
  });
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
    check_ins: journal.check_ins.filter((row) => row.trip_id !== trip_id),
  });
}

export function formatCoordinates(value: Coordinates): string {
  const position = parseCoordinates(value);
  return `${position.latitude.toFixed(5)}, ${position.longitude.toFixed(5)}`;
}
