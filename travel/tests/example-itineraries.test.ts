import { expect, test } from 'bun:test';
import { citiesOnDay } from '../src/lib/city-days';
import { offsetDay } from '../src/lib/dates';
import { parseJournal } from '../src/lib/model';
import { mapStops } from '../src/lib/map';
import { journal_schema_version } from '../src/lib/types';

const examples = [
  { file: 'kyoto', days: [['Kyoto']] },
  { file: 'singapore', days: [['Singapore'], ['Singapore'], ['Singapore']] },
  { file: 'kansai', days: [['Kyoto'], ['Kyoto', 'Nara'], ['Nara', 'Osaka']] },
];

for (const { file, days } of examples) {
  test(`${file} opens as a planned trip with an ordered map for every day`, async () => {
    const raw = await Bun.file(new URL(`../fixtures/${file}.json`, import.meta.url)).json();
    const journal = parseJournal(raw);
    expect(journal).toEqual({ ...raw, schema_version: journal_schema_version });
    expect(journal.trips).toHaveLength(1);
    expect(journal.check_ins).toEqual([]);
    const [trip] = journal.trips;
    expect(trip.end_date).toBe(offsetDay(trip.start_date, days.length - 1));
    const dates = days.map((_, index) => offsetDay(trip.start_date, index));
    expect([...new Set(journal.stops.map((stop) => stop.day))]).toEqual(dates);
    for (const [index, day] of dates.entries()) {
      expect(citiesOnDay(trip, day)).toEqual(days[index]);
      const stops = journal.stops.filter((stop) => stop.day === day);
      expect(stops.length).toBeGreaterThan(1);
      expect(mapStops(stops).points.map((point) => point.id)).toEqual(stops.map((stop) => stop.id));
    }
  });
}
