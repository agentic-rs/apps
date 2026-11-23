import { describe, expect, test } from 'bun:test';
import { changePacking, packingItems } from '../src/lib/packing';
import {
  addPhotoEvents,
  emptyJournal,
  formatCoordinates,
  max_photo_bytes,
  moveStop,
  parseCheckIn,
  parseJournal,
  parsePhotoAsset,
  parsePlace,
  parseStop,
  parseTrip,
  removeCheckIn,
  removeStop,
  removeTrip,
  saveCheckIn,
  undoStopAddition,
  upsertStop,
  upsertTrip,
  visitTitle,
} from '../src/lib/model';
import { journal_schema_version } from '../src/lib/types';
import type { CheckIn, Journal, PhotoAsset, Place, PlannedStop, Trip } from '../src/lib/types';

const now = '2026-05-12T14:20:00.000Z';
const legacy_trip: Trip = {
  id: 'trip-1',
  title: 'A spring weekend',
  description: '',
  start_date: '2026-05-12',
  end_date: '2026-05-14',
  created_at: now,
  updated_at: now,
};
const trip: Trip = { ...legacy_trip, cities: ['Shanghai'] };
const place: Place = {
  id: 'place-1',
  name: 'Lakeside park',
  locality: 'North district',
  position: { latitude: 12, longitude: 34 },
  created_at: now,
  updated_at: now,
};
const photo: PhotoAsset = {
  id: 'photo-1',
  path: 'images/photo-1.png',
  mime_type: 'image/png',
  size_bytes: 100,
};
const stop: PlannedStop = {
  id: 'stop-1',
  trip_id: trip.id,
  day: trip.start_date,
  title: 'Town market',
  kind: 'food',
  time: '',
  notes: 'Use the east entrance.',
  position: null,
};
const check_in: CheckIn = {
  id: 'visit-1',
  trip_id: trip.id,
  place_id: place.id,
  visited_at: now,
  utc_offset_minutes: 480,
  actual_location: {
    latitude: 12.01,
    longitude: 34.02,
    accuracy_m: 6,
    source: 'device',
    captured_at: now,
  },
  notes: 'An afternoon by the water.',
  photos: [photo],
  created_at: now,
  updated_at: now,
};

function populated(): Journal {
  return saveCheckIn(upsertTrip(emptyJournal(), trip), check_in, place);
}

describe('journal data integrity', () => {
  test('empty journals are independent and populated data round-trips through JSON', () => {
    const first = emptyJournal();
    first.trips.push(trip);
    expect(emptyJournal().trips).toEqual([]);
    const journal = populated();
    expect(parseJournal(JSON.parse(JSON.stringify(journal)))).toEqual(journal);
  });

  test('repeated visits share a place while preserving their own exact positions', () => {
    const initial = populated();
    const next = saveCheckIn(
      initial,
      {
        ...check_in,
        id: 'visit-2',
        photos: [],
        actual_location: {
          latitude: 12.05,
          longitude: 34.08,
          accuracy_m: null,
          source: 'manual',
          captured_at: null,
        },
      },
      { ...place, name: 'Lakeside garden', position: { latitude: 12.1, longitude: 34.1 } },
    );
    expect(next.places).toHaveLength(1);
    expect(next.check_ins).toHaveLength(2);
    expect(next.check_ins[0].actual_location).toEqual(check_in.actual_location);
    expect(next.check_ins[1].actual_location?.latitude).toBe(12.05);
    expect(next.places[0].position?.latitude).toBe(12.1);
    expect(initial.places[0].name).toBe('Lakeside park');
    expect(initial.check_ins).toHaveLength(1);
  });

  test('unknown visit and place coordinates remain unknown rather than zero or inferred', () => {
    const next = saveCheckIn(
      upsertTrip(emptyJournal(), trip),
      {
        ...check_in,
        actual_location: null,
      },
      { ...place, position: null },
    );
    expect(next.check_ins[0].actual_location).toBeNull();
    expect(next.places[0].position).toBeNull();
  });

  test('rejects dangling references and a supplied place that does not match the visit', () => {
    expect(() => saveCheckIn(emptyJournal(), check_in, place)).toThrow('missing trip');
    expect(() => parseJournal({ ...populated(), places: [] })).toThrow('missing place');
    expect(() => saveCheckIn(populated(), check_in, { ...place, id: 'place-2' })).toThrow('linked');
  });

  test('old visits retain their place heading and photo events persist without a named place', () => {
    expect(parseCheckIn(check_in)).toEqual(check_in);
    expect(visitTitle(check_in, place)).toBe(place.name);
    const draft = {
      ...check_in,
      place_id: null,
      title: '  A morning by the lake  ',
      actual_location: { ...check_in.actual_location!, source: 'photo' as const },
    };
    const saved = saveCheckIn(upsertTrip(emptyJournal(), trip), draft, null);
    expect(saved.places).toEqual([]);
    const [event] = parseJournal(JSON.parse(JSON.stringify(saved))).check_ins;
    expect(event).toEqual({ ...draft, title: draft.title.trim() });
    expect(visitTitle(event)).toBe('A morning by the lake');
    const linked = saveCheckIn(saved, { ...event, place_id: place.id }, place);
    expect(visitTitle(linked.check_ins[0], linked.places[0])).toBe(event.title!);
    expect(linked.places[0].name).toBe(place.name);
    expect(() => parseCheckIn({ ...event, title: '   ' })).toThrow('title');
    expect(() => parseCheckIn({ ...event, title: 'x'.repeat(201) })).toThrow('title');
    expect(() => saveCheckIn(saved, { ...event, place_id: place.id }, null)).toThrow('linked');
  });

  test('a batch of photo events is appended atomically with unique identities and photo ownership', () => {
    const journal = populated();
    const event: CheckIn = {
      ...check_in,
      id: 'event-1',
      title: 'Afternoon stop',
      place_id: null,
      photos: [{ ...photo, id: 'image-2', path: 'images/image-2.png' }],
    };
    const other: CheckIn = {
      ...event,
      id: 'event-2',
      photos: [{ ...photo, id: 'image-3', path: 'images/image-3.png' }],
    };
    const next = addPhotoEvents(journal, [event, other]);
    expect(next.check_ins).toEqual([check_in, event, other]);
    expect(next.places).toEqual(journal.places);
    expect(() => addPhotoEvents(journal, [event, event])).toThrow('duplicate');
    expect(() => addPhotoEvents(next, [event])).toThrow('duplicate');
    expect(() => addPhotoEvents(journal, [event, { ...other, photos: [photo] }])).toThrow(
      'duplicate',
    );
    expect(() => addPhotoEvents(journal, [event, { ...other, trip_id: 'missing' }])).toThrow(
      'missing trip',
    );
    expect(journal.check_ins).toEqual([check_in]);
  });

  test('rejects duplicate entity and image ownership identities', () => {
    const journal = populated();
    expect(() => parseJournal({ ...journal, trips: [trip, trip] })).toThrow('duplicate');
    expect(() => parseJournal({ ...journal, places: [place, place] })).toThrow('duplicate');
    expect(() => parseJournal({ ...journal, check_ins: [check_in, check_in] })).toThrow(
      'duplicate',
    );
    expect(() => saveCheckIn(journal, { ...check_in, id: 'visit-2' }, place)).toThrow('duplicate');
    expect(() =>
      saveCheckIn(
        journal,
        {
          ...check_in,
          id: 'visit-2',
          photos: [{ ...photo, id: 'photo-2' }],
        },
        place,
      ),
    ).toThrow('duplicate');
  });

  test('validates schema and missing fields before reading or saving', () => {
    expect(() => parseJournal(null)).toThrow();
    for (const schema_version of [0, 1.5, journal_schema_version + 1, '5'])
      expect(() => parseJournal({ ...emptyJournal(), schema_version })).toThrow('version');
    expect(() => parseJournal({ ...emptyJournal(), trips: {} })).toThrow('list');
    expect(() => parseJournal({ schema_version: 1 })).toThrow();
    expect(() => parseCheckIn({ ...check_in, actual_location: undefined })).toThrow();
    expect(() => parseTrip({ ...trip, title: '   ' })).toThrow();
    expect(() => parsePlace({ ...place, name: '' })).toThrow();
  });

  test('preserves directory identities and independent trip snapshots across reloads', () => {
    const city = { id: 'geonames:1857910', latitude: 35.02, longitude: 135.75, country_code: 'JP' };
    const route = { ...trip, cities: ['Kyoto', 'Custom city'], city_locations: [city, null] };
    expect(parseTrip(route)).toEqual(route);
    expect(() => parseTrip({ ...route, city_locations: [city] })).toThrow('match');
    expect(() =>
      parseTrip({ ...route, city_locations: [{ ...city, longitude: 190 }, null] }),
    ).toThrow();
    const stop: PlannedStop = {
      id: 'mapped',
      trip_id: trip.id,
      day: '2030-05-20',
      title: 'My airport stop',
      kind: 'transport',
      time: '',
      notes: 'Meet at arrivals',
      position: { latitude: 34.43, longitude: 135.23 },
      directory_ref: { provider: 'ourairports', id: 'ourairports:21' },
    };
    const saved = parseJournal({ ...emptyJournal(), trips: [route], stops: [stop] });
    expect(saved.stops[0]).toEqual(stop);
    expect(() => parseStop({ ...stop, directory_ref: { provider: 'unknown', id: '1' } })).toThrow(
      'source',
    );
  });

  test('accepts geographic boundaries and rejects nonfinite or out-of-range coordinates', () => {
    expect(parsePlace({ ...place, position: { latitude: -90, longitude: 180 } }).position).toEqual({
      latitude: -90,
      longitude: 180,
    });
    for (const position of [
      { latitude: NaN, longitude: 0 },
      { latitude: 91, longitude: 0 },
      { latitude: 0, longitude: -181 },
      { latitude: 0, longitude: Infinity },
      { latitude: '12', longitude: 34 },
    ]) {
      expect(() => parsePlace({ ...place, position })).toThrow('Latitude');
    }
    expect(() =>
      parseCheckIn({
        ...check_in,
        actual_location: { ...check_in.actual_location, accuracy_m: -1 },
      }),
    ).toThrow('accuracy');
  });

  test('trims names, preserves notes, and enforces calendar dates and local time offsets', () => {
    expect(parseTrip({ ...trip, title: '  A spring weekend  ' }).title).toBe(trip.title);
    expect(parsePlace({ ...place, name: '  Park  ', locality: ' North ' })).toMatchObject({
      name: 'Park',
      locality: 'North',
    });
    expect(parseCheckIn({ ...check_in, notes: '  preserve spaces\n' }).notes).toBe(
      '  preserve spaces\n',
    );
    expect(parseTrip({ ...trip, start_date: '', end_date: '' }).start_date).toBe('');
    expect(() => parseTrip({ ...trip, start_date: '2026-02-30' })).toThrow('date');
    expect(() => parseTrip({ ...trip, end_date: '2026-05-11' })).toThrow('on or after');
    expect(() => parseCheckIn({ ...check_in, visited_at: '2026-02-30T10:00:00.000Z' })).toThrow(
      'UTC',
    );
    expect(() => parseCheckIn({ ...check_in, utc_offset_minutes: 840.5 })).toThrow('offset');
  });

  test('round-trips city time and the recorded offset independently, including on older devices', () => {
    const original = populated();
    const zoned = { ...check_in, time_zone: 'America/Argentina/Buenos_Aires' };
    const saved = saveCheckIn(original, zoned, place);
    expect(parseJournal(JSON.parse(JSON.stringify(saved))).check_ins[0]).toEqual(zoned);
    expect(parseJournal({ ...original, schema_version: 8 }).check_ins[0]).toEqual(check_in);
    expect(parseCheckIn({ ...check_in, time_zone: 'Future/City' }).utc_offset_minutes).toBe(
      check_in.utc_offset_minutes,
    );
    for (const time_zone of ['', '   ', '/City', 'Area//City', {}, 540, 'A'.repeat(129)])
      expect(() => parseCheckIn({ ...check_in, time_zone })).toThrow('zone');
  });

  test('canonicalizes UTC timestamps for chronological ordering and rejects local year overflow', () => {
    const whole_second = parseCheckIn({ ...check_in, visited_at: '2026-05-12T14:20:00Z' });
    const fractional_second = parseCheckIn({ ...check_in, visited_at: '2026-05-12T14:20:00.123Z' });
    expect(whole_second.visited_at).toBe('2026-05-12T14:20:00.000Z');
    expect(whole_second.visited_at.localeCompare(fractional_second.visited_at)).toBeLessThan(0);
    expect(() =>
      parseCheckIn({
        ...check_in,
        visited_at: '9999-12-31T23:00:00.000Z',
        utc_offset_minutes: 480,
      }),
    ).toThrow('date range');
  });

  test('upserts edits without duplicating a trip or check-in', () => {
    let journal = populated();
    journal = upsertTrip(journal, { ...trip, title: 'Spring trip' });
    journal = saveCheckIn(journal, { ...check_in, notes: 'Updated.' }, place);
    expect(journal.trips).toHaveLength(1);
    expect(journal.trips[0].title).toBe('Spring trip');
    expect(journal.check_ins).toHaveLength(1);
    expect(journal.check_ins[0].notes).toBe('Updated.');
  });

  test('deleting a trip removes only its visits and retains reusable places', () => {
    let journal = upsertTrip(populated(), { ...trip, id: 'trip-2', title: 'Next journey' });
    journal = saveCheckIn(
      journal,
      {
        ...check_in,
        id: 'visit-2',
        trip_id: 'trip-2',
        photos: [],
        actual_location: null,
      },
      place,
    );
    const next = removeTrip(journal, 'trip-1');
    expect(next.trips.map((row) => row.id)).toEqual(['trip-2']);
    expect(next.check_ins.map((row) => row.id)).toEqual(['visit-2']);
    expect(next.places).toEqual([place]);
    expect(journal.check_ins).toHaveLength(2);
    const without_visit = removeCheckIn(next, 'visit-2');
    expect(without_visit.check_ins).toEqual([]);
    expect(without_visit.trips).toHaveLength(1);
    expect(without_visit.places).toEqual([place]);
  });
});

describe('trip cities', () => {
  test('opens an older trip without inferring cities from its title, places, or stops', () => {
    const original = { ...upsertStop(populated(), stop), trips: [legacy_trip] };
    const saved = parseJournal({ ...original, schema_version: 3 });
    expect(saved.trips[0].cities).toBeUndefined();
    expect(saved).toEqual({ ...original, schema_version: journal_schema_version });
    expect(
      upsertTrip(saved, { ...legacy_trip, title: 'Next year' }).trips[0].cities,
    ).toBeUndefined();
    const edited = upsertTrip(saved, { ...trip, cities: ['上海', '杭州'] });
    expect(edited).toEqual({
      ...saved,
      trips: [{ ...trip, cities: ['上海', '杭州'] }],
    });
  });

  test('retains city order and return visits through metadata edits and a storage round trip', () => {
    const saved = upsertTrip(populated(), { ...trip, cities: ['  Kyoto ', 'Osaka', 'Kyoto'] });
    const renamed = upsertTrip(saved, { ...legacy_trip, title: 'Autumn in Japan' });
    expect(parseJournal(JSON.parse(JSON.stringify(renamed))).trips[0]).toEqual({
      ...trip,
      title: 'Autumn in Japan',
      cities: ['Kyoto', 'Osaka', 'Kyoto'],
    });
    const changed = upsertTrip(renamed, { ...renamed.trips[0], cities: ['Nara', 'Kyoto'] });
    expect(changed.trips[0].cities).toEqual(['Nara', 'Kyoto']);
    expect(renamed.trips[0].cities).toEqual(['Kyoto', 'Osaka', 'Kyoto']);
  });

  test('requires a starting city for new trips and validates each city name', () => {
    expect(() => upsertTrip(emptyJournal(), legacy_trip)).toThrow('starting city');
    expect(() => parseTrip({ ...trip, cities: [] })).toThrow('starting city');
    for (const cities of ['Nara', null, [3], ['Nara', '  '], ['x'.repeat(121)]])
      expect(() => parseTrip({ ...trip, cities })).toThrow();
  });

  test('migrates schema-4 routes with open dates, and preserves scheduled transfers through metadata edits', () => {
    const route = { ...trip, cities: ['Tokyo', 'Kyoto', 'Tokyo'] };
    const original = { ...populated(), trips: [route] };
    const migrated = parseJournal({ ...original, schema_version: 4 });
    expect(migrated).toEqual(original);
    expect(migrated.trips[0].city_arrival_dates).toBeUndefined();
    const city_arrival_dates = ['', trip.start_date, trip.end_date];
    const dated = upsertTrip(migrated, { ...route, city_arrival_dates });
    const renamed = upsertTrip(dated, { ...legacy_trip, title: 'Japan' });
    const reopened = parseJournal(JSON.parse(JSON.stringify(renamed)));
    expect(reopened).toEqual({
      ...original,
      trips: [{ ...route, title: 'Japan', city_arrival_dates }],
    });
    const cleared = upsertTrip(reopened, { ...route, city_arrival_dates: ['', '', ''] });
    expect(cleared.trips[0].city_arrival_dates).toBeUndefined();
  });

  test('checks the shape, range and chronological order of city dates', () => {
    const cities = ['Tokyo', 'Kyoto', 'Nara', 'Osaka'];
    const arrival = '2026-05-13';
    for (const city_arrival_dates of [
      null,
      ['', arrival],
      [arrival, '', '', ''],
      ['', '2026-05-00', '', ''],
      ['', '2026-05-11', '', ''],
      ['', '', '', '2026-05-15'],
      ['', arrival, '', trip.start_date],
    ]) {
      expect(() => parseTrip({ ...trip, cities, city_arrival_dates })).toThrow();
    }
    expect(() => parseTrip({ ...legacy_trip, city_arrival_dates: [] })).toThrow();
    const city_arrival_dates = ['', arrival, '', arrival];
    expect(parseTrip({ ...trip, cities, city_arrival_dates }).city_arrival_dates).toEqual(
      city_arrival_dates,
    );
  });
});

describe('planned stops', () => {
  test('stay dates, place type and address survive save and reopen', () => {
    const stay: PlannedStop = {
      ...stop,
      kind: 'stay',
      city: 'Nara',
      city_id: 'geonames:1855612',
      checkout_date: '2026-05-15',
      directory_ref: { provider: 'osm', id: 'N12', place_type: 'hostel', subtitle: 'Nara, Japan' },
    };
    const next = upsertStop(populated(), stay);
    expect(parseJournal(JSON.parse(JSON.stringify(next))).stops).toEqual([stay]);
    expect(() => parseStop({ ...stay, city: undefined })).toThrow('city name');
    expect(() => parseStop({ ...stay, city_id: 'unknown' })).toThrow('city identifier');
    for (const checkout_date of [stay.day, '2026-05-01', '2026-02-30']) {
      expect(() => parseStop({ ...stay, checkout_date })).toThrow('check-out');
    }
    expect(() => parseStop({ ...stay, kind: 'sight' })).toThrow('check-out');
    const old_stay: PlannedStop = { ...stop, kind: 'stay' };
    expect(parseJournal({ ...next, schema_version: 6, stops: [old_stay] }).stops).toEqual([
      old_stay,
    ]);
  });

  test('preserves the source and address of older stops and ignores unfamiliar place types', () => {
    const directory_ref = { provider: 'osm' as const, id: 'N12', subtitle: 'Nara, Japan' };
    for (const source of [directory_ref, { ...directory_ref, place_type: 'unrecognized' }]) {
      expect(parseStop({ ...stop, directory_ref: source }).directory_ref).toEqual(directory_ref);
    }
    const geo_ref = { provider: 'geoapify' as const, id: 'place-12' };
    const identified = { ...geo_ref, osm_ref: 'R12', name: 'Nara Museum', country_code: 'JP' };
    expect(parseStop({ ...stop, directory_ref: identified }).directory_ref).toEqual(identified);
    expect(
      parseStop({ ...stop, directory_ref: { ...geo_ref, osm_ref: '12' } }).directory_ref,
    ).toEqual(geo_ref);
  });

  test('migrates schema 1 visits, photo events, exact coordinates and original photo references', () => {
    const old_event: CheckIn = {
      ...check_in,
      id: 'event',
      title: 'Morning light',
      place_id: null,
      photos: [{ ...photo, id: 'morning', path: 'images/morning.png' }],
      actual_location: { ...check_in.actual_location!, source: 'photo' },
    };
    const old = {
      schema_version: 1,
      trips: [legacy_trip],
      places: [place],
      check_ins: [check_in, old_event],
    };
    const migrated = parseJournal(old);
    expect(migrated).toEqual({ ...old, schema_version: journal_schema_version, stops: [] });
    expect(parseJournal(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
    expect(() => parseJournal({ ...old, places: [] })).toThrow('missing place');
    expect(() => parseJournal({ ...migrated, stops: undefined })).toThrow('list');
  });

  test('requires valid stop dates, local times, categories, references and positions', () => {
    expect(parseStop({ ...stop, title: '  Town market  ', time: '00:00' })).toEqual({
      ...stop,
      time: '00:00',
    });
    expect(parseStop({ ...stop, time: '23:59' }).time).toBe('23:59');
    for (const time of ['8:30', '24:00', '12:60', '09:00Z']) {
      expect(() => parseStop({ ...stop, time })).toThrow('time');
    }
    for (const day of ['', '2026-02-29', '2026-3-04'])
      expect(() => parseStop({ ...stop, day })).toThrow('date');
    expect(() => parseStop({ ...stop, kind: 'unknown' })).toThrow('category');
    expect(() => parseStop({ ...stop, title: '   ' })).toThrow('title');
    expect(() => parseStop({ ...stop, position: { latitude: 200, longitude: 0 } })).toThrow(
      'Latitude',
    );
    expect(() => upsertStop(emptyJournal(), stop)).toThrow('missing trip');
    expect(() => parseJournal({ ...populated(), stops: [stop, stop] })).toThrow('duplicate');
  });

  test('reorders within the same trip day, preserves edits in place and appends on a day change', () => {
    const other_trip = { ...trip, id: 'other-trip' };
    const tomorrow = { ...stop, id: 'tomorrow', day: '2026-05-13' };
    const unrelated = { ...stop, id: 'unrelated', trip_id: other_trip.id };
    const ferry = { ...stop, id: 'ferry', time: '09:00' };
    let journal = upsertTrip(populated(), other_trip);
    for (const planned of [stop, tomorrow, unrelated, ferry])
      journal = upsertStop(journal, planned);
    const ord = (value: Journal) => value.stops.map((row) => row.id);
    const reordered = moveStop(journal, ferry.id, -1);
    expect(ord(reordered)).toEqual([ferry.id, tomorrow.id, unrelated.id, stop.id]);
    expect(ord(moveStop(reordered, ferry.id, 1))).toEqual(ord(journal));
    expect(moveStop(reordered, ferry.id, -1)).toEqual(reordered);
    expect(moveStop(reordered, unrelated.id, 1)).toEqual(reordered);
    const edited = upsertStop(reordered, { ...ferry, title: 'Ferry platform' });
    expect(ord(edited)).toEqual(ord(reordered));
    expect(edited.stops[0].title).toBe('Ferry platform');
    const moved = upsertStop(edited, { ...ferry, day: tomorrow.day });
    expect(moved.stops.filter((row) => row.day === tomorrow.day)).toEqual([
      tomorrow,
      { ...ferry, day: tomorrow.day },
    ]);
  });

  test('inserts before a stop in a legacy, interleaved itinerary and can replay the same save', () => {
    const other_trip = { ...legacy_trip, id: 'other-trip' };
    const unrelated = { ...stop, id: 'unrelated', trip_id: other_trip.id };
    const tomorrow = { ...stop, id: 'tomorrow', day: '2026-05-13' };
    const lunch = { ...stop, id: 'lunch', title: 'Lunch' };
    const museum = { ...stop, id: 'museum', title: 'Museum' };
    const original = parseJournal({
      ...populated(),
      schema_version: 2,
      trips: [legacy_trip, other_trip],
      stops: [stop, tomorrow, lunch, unrelated],
    });
    const inserted = upsertStop(original, museum, lunch.id);
    expect(inserted.stops).toEqual([stop, tomorrow, museum, lunch, unrelated]);
    expect(upsertStop(inserted, museum, lunch.id)).toEqual(inserted);
    expect(original.stops).toEqual([stop, tomorrow, lunch, unrelated]);

    const renamed = { ...museum, title: 'City museum' };
    const first = upsertStop(inserted, renamed, stop.id);
    expect(first.stops).toEqual([renamed, stop, tomorrow, lunch, unrelated]);
    expect(upsertStop(first, renamed, renamed.id)).toEqual(first);
    const last = upsertStop(first, renamed, null);
    expect(last.stops).toEqual([stop, tomorrow, lunch, unrelated, renamed]);
    expect(upsertStop(last, renamed, null)).toEqual(last);
    expect(parseJournal(JSON.parse(JSON.stringify(last)))).toEqual(last);
  });

  test('moves a linked stop to a chosen position on another day and keeps its visit', () => {
    const first = { ...stop, id: 'first', day: '2026-05-13' };
    const second = { ...first, id: 'second' };
    const original = parseJournal({
      ...populated(),
      stops: [first, stop, second],
      check_ins: [{ ...check_in, stop_id: stop.id }],
    });
    const moved = { ...stop, day: first.day };
    const next = upsertStop(original, moved, second.id);
    expect(next.stops).toEqual([first, moved, second]);
    expect(next.check_ins).toEqual(original.check_ins);
    expect(upsertStop(next, moved, second.id)).toEqual(next);
    expect(upsertStop(original, moved).stops).toEqual([first, second, moved]);
    expect(upsertStop(original, moved, moved.id).stops).toEqual([first, second, moved]);
  });

  test('a deleted anchor or one on another day or trip requires a fresh choice', () => {
    const other_trip = { ...trip, id: 'other-trip' };
    const anchor = { ...stop, id: 'anchor' };
    const edited = { ...stop, title: 'Updated stop' };
    const original = parseJournal({
      ...populated(),
      trips: [trip, other_trip],
      stops: [anchor, stop],
    });
    for (const changed of [
      removeStop(original, anchor.id),
      upsertStop(original, { ...anchor, day: '2026-05-13' }),
      upsertStop(original, { ...anchor, trip_id: other_trip.id }),
    ]) {
      expect(() => upsertStop(changed, edited, anchor.id)).toThrow('Choose another position');
      expect(changed.stops.find((item) => item.id === stop.id)).toEqual(stop);
      expect(upsertStop(changed, edited, null).stops.at(-1)).toEqual(edited);
    }
  });

  test('validates stop links and retains recorded visits when a planned stop is removed', () => {
    const other_trip = { ...trip, id: 'trip-2' };
    const other_stop = { ...stop, id: 'stop-2', trip_id: other_trip.id };
    const journal = upsertStop(upsertStop(upsertTrip(populated(), other_trip), stop), other_stop);
    const linked = saveCheckIn(journal, { ...check_in, stop_id: stop.id }, place);
    expect(linked.check_ins[0].actual_location).toEqual(check_in.actual_location);
    for (const stop_id of ['missing', other_stop.id]) {
      expect(() => saveCheckIn(journal, { ...check_in, stop_id }, place)).toThrow('same trip');
    }
    expect(removeStop(linked, stop.id)).toEqual({ ...journal, stops: [other_stop] });
    expect(removeCheckIn(linked, check_in.id).stops).toEqual([stop, other_stop]);
    const deleted = removeTrip(linked, trip.id);
    expect(deleted.stops).toEqual([other_stop]);
    expect(deleted.check_ins).toEqual([]);
    expect(deleted.places).toEqual([place]);
  });

  test('undo removes only the last addition even when another visit has the same place and dates', () => {
    const hotel: PlannedStop = {
      ...stop,
      id: 'first-stay',
      kind: 'stay',
      title: 'Nara Hotel',
      city: 'Nara',
      checkout_date: '2026-05-14',
      position: { latitude: 34.68, longitude: 135.83 },
      directory_ref: { provider: 'osm', id: 'W123' },
    };
    const new_stay = { ...hotel, id: 'new-stay', title: ' Nara Hotel ' };
    const journal = upsertStop(populated(), hotel);
    const with_addition = upsertStop(journal, new_stay, hotel.id);
    const current = saveCheckIn(with_addition, { ...check_in, stop_id: hotel.id }, place);
    const undone = undoStopAddition(current, new_stay);
    expect(undone).toEqual({ ...current, stops: [hotel] });
    expect(current.stops.map((item) => item.id)).toEqual([new_stay.id, hotel.id]);
    expect(undoStopAddition(undone, new_stay)).toBe(undone);
  });

  test('undo preserves later edits and linked check-ins on the added stop', () => {
    const journal = upsertStop(populated(), stop);
    for (const updated of [
      { ...stop, notes: 'Meet at the station.' },
      { ...stop, day: '2026-05-13' },
      { ...stop, kind: 'stay' as const, checkout_date: '2026-05-14' },
    ]) {
      const current = upsertStop(journal, updated);
      expect(() => undoStopAddition(current, stop)).toThrow('edited');
      expect(current.stops).toEqual([updated]);
    }
    const linked = saveCheckIn(journal, { ...check_in, stop_id: stop.id }, place);
    expect(() => undoStopAddition(linked, stop)).toThrow('check-in');
    expect(linked.check_ins[0]).toEqual({ ...check_in, stop_id: stop.id });
  });
});

describe('photos and display', () => {
  test('restricts photos to owned relative image paths', () => {
    for (const path of [
      '../images/a.png',
      '/images/a.png',
      'images/../a.png',
      'images\\a.png',
      'journal.json',
      'images/a.svg',
      'images/a.png/extra',
      'images/%2e%2e.png',
    ]) {
      expect(() => parsePhotoAsset({ ...photo, path })).toThrow('path');
    }
    expect(
      parsePhotoAsset({ ...photo, path: 'images/test-2.JPEG', mime_type: 'image/jpeg' }).path,
    ).toBe('images/test-2.JPEG');
  });

  test('enforces image formats, sizes and per-visit limits', () => {
    expect(() => parsePhotoAsset({ ...photo, mime_type: 'text/html' })).toThrow('Choose');
    for (const size_bytes of [0, -1, NaN, 1.5, max_photo_bytes + 1]) {
      expect(() => parsePhotoAsset({ ...photo, size_bytes })).toThrow('32 MiB');
    }
    expect(parsePhotoAsset({ ...photo, size_bytes: max_photo_bytes }).size_bytes).toBe(
      max_photo_bytes,
    );
    const photos = Array.from({ length: 21 }, (_, index) => ({
      ...photo,
      id: `photo-${index}`,
      path: `images/photo-${index}.png`,
    }));
    expect(() => parseCheckIn({ ...check_in, photos })).toThrow('20 photos');
  });

  test('coordinates are concise and preserve signed values', () => {
    expect(formatCoordinates({ latitude: -12.1234567, longitude: 34 })).toBe('-12.12346, 34.00000');
  });
});

describe('trip packing lists', () => {
  test('migrates a saved itinerary with a starter list unique to each trip', () => {
    const original = {
      ...upsertStop(populated(), stop),
      trips: [legacy_trip, { ...legacy_trip, id: 'other-trip' }],
    };
    const journal = parseJournal({ ...original, schema_version: 2 });
    expect(journal).toEqual(original);
    const items = packingItems(journal.trips[0]);
    expect(items.map((item) => item.title)).toContain('Phone charger');
    expect(items.every((item) => !item.packed)).toBe(true);
    const packed = changePacking(journal.trips[0], { kind: 'pack', id: items[0].id, packed: true });
    const saved = upsertTrip(journal, packed);
    expect(packingItems(saved.trips[0])[0].packed).toBe(true);
    expect(packingItems(saved.trips[1])).toEqual(items);
    expect(saved.check_ins).toEqual(original.check_ins);
    expect(saved.stops).toEqual(original.stops);
    expect(saved.schema_version).toBe(journal_schema_version);
    expect(parseJournal(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });

  test('preserves custom item identities, status, and an intentionally empty list through metadata edits', () => {
    const initial = changePacking(
      { ...trip, packing_items: [] },
      { kind: 'add', id: 'camera', title: ' Camera ' },
    );
    const checked = changePacking(initial, { kind: 'pack', id: 'camera', packed: true });
    const renamed = changePacking(checked, {
      kind: 'rename',
      id: 'camera',
      title: ' Camera strap ',
    });
    const metadata_only = { ...trip, title: 'Winter trip' };
    const journal = upsertTrip(upsertTrip(emptyJournal(), renamed), metadata_only);
    expect(packingItems(journal.trips[0])).toEqual([
      { id: 'camera', title: 'Camera strap', packed: true },
    ]);
    expect(packingItems(initial)[0]).toEqual({ id: 'camera', title: 'Camera', packed: false });
    const removed = changePacking(journal.trips[0], { kind: 'remove', id: 'camera' });
    const reopened = parseJournal(JSON.parse(JSON.stringify(upsertTrip(journal, removed))));
    expect(packingItems(reopened.trips[0])).toEqual([]);
    expect(packingItems(upsertTrip(reopened, metadata_only).trips[0])).toEqual([]);
  });

  test('rejects damaged persisted items, duplicate identities, and updates to a missing item', () => {
    const item = { id: 'one', title: 'Charger', packed: false };
    for (const list of [
      null,
      [item, item],
      [{ ...item, id: 'bad/id' }],
      [{ ...item, title: ' ' }],
      [{ ...item, packed: 'yes' }],
    ]) {
      expect(() => parseTrip({ ...trip, packing_items: list })).toThrow();
    }
    const saved = { ...trip, packing_items: [item] };
    expect(() => changePacking(saved, { kind: 'add', id: 'one', title: 'Second' })).toThrow();
    expect(() => changePacking(saved, { kind: 'pack', id: 'missing', packed: true })).toThrow();
  });
});
