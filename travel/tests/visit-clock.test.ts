import { describe, expect, test } from 'bun:test';
import { currentOffsetMinutes, fromVisitInput, toVisitInput } from '../src/lib/dates';
import { formatUtcOffset, visitClock } from '../src/lib/visit-clock';

const opened_at = Date.parse('2030-05-20T16:37:15.127Z');
const day = '2030-05-21';

describe('itinerary check-in clocks', () => {
  test('keeps the itinerary day and uses the destination clock across midnight', () => {
    const tokyo = visitClock(day, opened_at, undefined, 'Asia/Tokyo');
    expect(tokyo.local_time).toBe(day + 'T01:37');
    expect(tokyo.offset).toBe(540);
    expect(fromVisitInput(tokyo.local_time, tokyo.offset!)).toBe('2030-05-20T16:37:00.000Z');
    expect(visitClock('2030-06-01', opened_at, undefined, 'Asia/Kathmandu')).toMatchObject({
      local_time: '2030-06-01T22:22',
      offset: 345,
    });
  });

  test('uses the actual visit date for the offset independent of when the form opened', () => {
    const new_york = (date: string) => visitClock(day, opened_at, date, 'America/New_York');
    expect(new_york('2030-01-08T18:20').offset).toBe(-300);
    expect(new_york('2030-07-08T18:20').offset).toBe(-240);
    expect(visitClock(day, opened_at, '2030-07-08T18:20', 'Pacific/Chatham').offset).toBe(765);
  });

  test('an ambiguous clock exposes both instants and a live check-in keeps its occurrence', () => {
    const time = '2026-11-01T01:30';
    const first = visitClock(day, opened_at, time, 'America/New_York');
    expect(first.offsets).toEqual([-240, -300]);
    expect(first.offset).toBe(-240);
    expect(fromVisitInput(time, first.offset!)).toBe('2026-11-01T05:30:00.000Z');
    const live = visitClock(
      '2026-11-01',
      Date.parse('2026-11-01T06:30:05Z'),
      undefined,
      'America/New_York',
    );
    expect(live.local_time).toBe(time);
    expect(live.offset).toBe(-300);
    expect(visitClock(day, opened_at, '2026-04-05T01:45', 'Australia/Lord_Howe').offsets).toEqual([
      660, 630,
    ]);
  });

  test('choosing the second occurrence keeps the named zone and only applies at that wall time', () => {
    const local_time = '2026-11-01T01:30';
    const time_zone = 'America/New_York';
    const second = { local_time, time_zone, offset: -300 };
    const selected = visitClock(day, opened_at, local_time, time_zone, undefined, second);
    expect(selected).toMatchObject({ offset: -300, time_zone });
    const saved = {
      visited_at: fromVisitInput(local_time, selected.offset!),
      utc_offset_minutes: -300,
      time_zone,
    };
    expect(saved.visited_at).toBe('2026-11-01T06:30:00.000Z');
    expect(visitClock(day, opened_at, local_time, undefined, saved).offset).toBe(-300);
    const first = visitClock(day, opened_at, local_time, undefined, saved, {
      ...second,
      offset: -240,
    });
    expect(first).toMatchObject({ offset: -240, time_zone });
    expect(fromVisitInput(local_time, first.offset!)).toBe('2026-11-01T05:30:00.000Z');
    expect(visitClock(day, opened_at, '2026-07-01T01:30', undefined, saved, second)).toMatchObject({
      offset: -240,
      time_zone,
    });
    expect(
      visitClock(day, opened_at, '2026-11-01T01:31', time_zone, undefined, second).offset,
    ).toBe(-240);
    // Toronto has the same candidate offsets. A preference for this wall time in New York stays local to that city.
    expect(
      visitClock(day, opened_at, local_time, 'America/Toronto', undefined, second).offset,
    ).toBe(-240);
  });

  test('rejects missing hours, half-hours and a skipped calendar day in automatic mode', () => {
    for (const [time, zone] of [
      ['2026-03-08T02:30', 'America/New_York'],
      ['2026-10-04T02:15', 'Australia/Lord_Howe'],
      ['2011-12-30T12:00', 'Pacific/Apia'],
    ]) {
      const clock = visitClock(day, opened_at, time, zone);
      expect(clock.local_time).toBe(time);
      expect(clock.offset).toBeUndefined();
      expect(clock.issue).toBe('gap');
    }
    expect(visitClock(day, opened_at, '2026-03-08T03:00', 'America/New_York').offset).toBe(-240);
  });

  test('unknown zones fall back to the device, and an empty field stays empty', () => {
    const current_device_offset = currentOffsetMinutes(new Date(opened_at));
    const local_now = toVisitInput(new Date(opened_at).toISOString(), current_device_offset);
    const local_time = day + 'T' + local_now.slice(11);
    for (const zone of [undefined, 'Unknown/Clock']) {
      const clock = visitClock(day, opened_at, undefined, zone);
      expect(clock.time_zone).toBeUndefined();
      expect(clock.local_time).toBe(local_time);
      expect(clock.offset).toBe(currentOffsetMinutes(new Date(local_time)) || 0);
    }
    expect(visitClock(day, opened_at, '', 'Asia/Kathmandu')).toMatchObject({
      local_time: '',
      offset: undefined,
      issue: undefined,
    });
    expect(formatUtcOffset(345)).toBe('UTC+05:45');
    expect(formatUtcOffset(-210)).toBe('UTC−03:30');
    expect(formatUtcOffset(0)).toBe('UTC+00:00');
  });

  test('a named journal entry retains its recorded offset until its wall time is edited', () => {
    const saved = {
      visited_at: '2026-11-01T06:30:47.123Z',
      utc_offset_minutes: -300,
      time_zone: 'America/New_York',
    };
    const unchanged = visitClock(day, opened_at, '2026-11-01T01:30', 'Asia/Tokyo', saved);
    expect(unchanged.offset).toBe(-300);
    expect(unchanged.time_zone).toBe('America/New_York');
    expect(visitClock(day, opened_at, '2026-07-08T18:20', undefined, saved).offset).toBe(-240);
    const superseded = { ...saved, utc_offset_minutes: -360 };
    expect(visitClock(day, opened_at, '2026-11-01T00:30', undefined, superseded).offset).toBe(-360);
  });

  test('an unavailable recorded zone keeps the old offset and preserves its name for untouched visits', () => {
    const recorded = {
      visited_at: '2026-01-15T16:30:09Z',
      utc_offset_minutes: -300,
      time_zone: 'Unavailable/City',
    };
    const original = visitClock(day, opened_at, '2026-01-15T11:30', 'Asia/Tokyo', recorded);
    expect(original).toMatchObject({
      offset: -300,
      time_zone: 'Unavailable/City',
      unavailable_recorded_zone: true,
    });
    const edited = visitClock(day, opened_at, '2026-07-15T11:30', 'Asia/Tokyo', recorded);
    expect(edited).toMatchObject({
      offset: -300,
      time_zone: undefined,
      unavailable_recorded_zone: true,
    });
  });
});
