import { describe, expect, test } from 'bun:test';
import {
  currentOffsetMinutes,
  daysBetween,
  formatTripDates,
  formatVisitDate,
  formatVisitTime,
  fromVisitInput,
  isCalendarDate,
  isUtcTimestamp,
  offsetDay,
  toVisitInput,
} from '../src/lib/dates';

describe('visit time zones', () => {
  test('round-trips local visit time with a stored offset across UTC date boundaries', () => {
    const iso = fromVisitInput('2026-05-12T00:30', 480);
    expect(iso).toBe('2026-05-11T16:30:00.000Z');
    expect(toVisitInput(iso, 480)).toBe('2026-05-12T00:30');
    expect(formatVisitDate(iso, 480)).toBe('12 May 2026');
    expect(formatVisitTime(iso, 480)).toBe('00:30');
  });

  test('supports negative offsets and half-hour time zones without using the host zone', () => {
    expect(fromVisitInput('2026-12-31T23:45', -210)).toBe('2027-01-01T03:15:00.000Z');
    expect(fromVisitInput('2026-01-01T00:15', 330)).toBe('2025-12-31T18:45:00.000Z');
    expect(toVisitInput('2027-01-01T03:15:00.000Z', -210)).toBe('2026-12-31T23:45');
  });

  test('reopening uses the saved offset, even if the device has moved to another zone', () => {
    const instant = '2026-05-12T22:00:00.000Z';
    expect(toVisitInput(instant, 480)).toBe('2026-05-13T06:00');
    expect(toVisitInput(instant, -240)).toBe('2026-05-12T18:00');
    const device_date = new Date();
    expect(currentOffsetMinutes(device_date)).toBe(-device_date.getTimezoneOffset());
  });

  test('rejects partial, impossible or timezone-ambiguous input', () => {
    for (const value of [
      '',
      '2026-05-12',
      '2026-02-29T10:00',
      '2026-02-30T10:00',
      '2026-05-12T24:00',
      '2026-05-12T12:60',
      '2026-05-12T10:00Z',
    ]) {
      expect(() => fromVisitInput(value, 0)).toThrow();
    }
    for (const offset of [NaN, Infinity, 841, -841, 60.5]) {
      expect(() => fromVisitInput('2026-05-12T10:00', offset)).toThrow('offset');
      expect(() => toVisitInput('2026-05-12T10:00:00.000Z', offset)).toThrow('offset');
    }
    expect(() => toVisitInput('2026-05-12T10:00:00+01:00', 0)).toThrow('invalid');
  });
});

describe('calendar validation', () => {
  test('counts and offsets itinerary days across leap years, DST dates and year boundaries', () => {
    expect(offsetDay('2024-02-28', 1)).toBe('2024-02-29');
    expect(offsetDay('2026-01-01', -1)).toBe('2025-12-31');
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
    expect(daysBetween('2026-03-09', '2026-03-07')).toBe(-2);
    expect(offsetDay('0000-01-01', 0)).toBe('0000-01-01');
    expect(() => offsetDay('9999-12-31', 1)).toThrow('range');
    expect(() => offsetDay('0000-01-01', -1)).toThrow('range');
    expect(() => offsetDay('2026-04-31', 1)).toThrow('date');
    expect(() => offsetDay('2026-04-01', 1.5)).toThrow('whole number');
    expect(() => daysBetween('2026-04-01', '')).toThrow('date');
  });

  test('validates leap years and exact UTC timestamp spelling', () => {
    expect(isCalendarDate('2024-02-29')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2026-04-31')).toBe(false);
    expect(isCalendarDate('2026-4-01')).toBe(false);
    expect(isUtcTimestamp('2026-05-12T10:00:00Z')).toBe(true);
    expect(isUtcTimestamp('2026-05-12T10:00:00.123Z')).toBe(true);
    expect(isUtcTimestamp('2026-05-12T24:00:00.000Z')).toBe(false);
    expect(isUtcTimestamp('2026-05-12T10:00:00')).toBe(false);
  });

  test('formats optional trip dates without adding device timezone shifts', () => {
    // ICU versions differ in the spacing around the range separator.
    const normalizeRange = (label: string) => label.replace(/\s*–\s*/g, ' – ');

    expect(formatTripDates('', '')).toBe('Dates open');
    expect(formatTripDates('2026-05-12', '')).toBe('12 May 2026');
    expect(formatTripDates('', '2026-05-14')).toBe('Until 14 May 2026');
    expect(normalizeRange(formatTripDates('2026-05-12', '2026-05-14'))).toBe('12 – 14 May 2026');
    expect(normalizeRange(formatTripDates('2026-05-12', '2026-06-02'))).toBe('12 May – 2 Jun 2026');
    expect(normalizeRange(formatTripDates('2026-05-12', '2027-01-01'))).toBe(
      '12 May 2026 – 1 Jan 2027',
    );
    expect(formatTripDates('2026-05-12', '2026-05-12')).toBe('12 May 2026');
  });
});
