import { currentOffsetMinutes, isUtcTimestamp, toVisitInput } from './dates';
import type { CheckIn } from './types';

const minute_ms = 60_000;
const day_ms = 24 * 60 * minute_ms;

export function formatUtcOffset(minutes: number): string {
  const absolute = Math.abs(minutes);
  return (
    'UTC' +
    (minutes < 0 ? '−' : '+') +
    String(Math.floor(absolute / 60)).padStart(2, '0') +
    ':' +
    String(absolute % 60).padStart(2, '0')
  );
}

/** An older OS can lack a recently introduced IANA identifier. */
function cityClock(time_zone?: string) {
  if (!time_zone) return;
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: time_zone, timeZoneName: 'longOffset' });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }
}

function offsetAt(clock: Intl.DateTimeFormat | undefined, instant: number): number {
  if (!clock) return currentOffsetMinutes(new Date(instant));
  const name = clock.formatToParts(instant).find((part) => part.type === 'timeZoneName')!.value;
  if (name === 'GMT') return 0;
  // Historical offsets can include seconds. Only whole minutes can be saved in the journal.
  const parts = /^GMT([+−-])(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(name);
  if (!parts) return NaN;
  const minutes = Number(parts[2]) * 60 + Number(parts[3]) + Number(parts[4] ?? 0) / 60;
  return parts[1] === '+' ? minutes : -minutes;
}

export interface VisitOccurrence {
  local_time: string;
  time_zone?: string;
  offset: number;
}

/** Keep the itinerary date while showing the destination's clock at the instant the form opened.
 * An explicit wall time remains fixed when the proposed destination changes.
 */
export function visitClock(
  day: string,
  opened_at: number,
  entered_time?: string,
  destination_zone?: string,
  recorded?: Pick<CheckIn, 'visited_at' | 'utc_offset_minutes' | 'time_zone'>,
  occurrence?: VisitOccurrence,
) {
  const time_zone = recorded?.time_zone || destination_zone;
  let clock = cityClock(time_zone);
  let now_offset = offsetAt(clock, opened_at);
  if (!Number.isFinite(now_offset)) {
    clock = undefined;
    now_offset = currentOffsetMinutes(new Date(opened_at));
  }
  const local_now = new Date(opened_at + now_offset * minute_ms).toISOString().slice(0, 16);
  const local_time = entered_time ?? day + 'T' + local_now.slice(11);
  const wall_iso = local_time + ':00.000Z';
  const offsets: number[] = [];
  let issue: 'gap' | 'unsupported' | undefined;
  if (isUtcTimestamp(wall_iso)) {
    const wall = Date.parse(wall_iso);
    // Sample both sides of a clock change, then verify each candidate at its actual UTC instant.
    // Two matches identify a repeated time; no match identifies a skipped time.
    const candidates = new Set([offsetAt(clock, wall - day_ms), offsetAt(clock, wall + day_ms)]);
    for (const offset of candidates) {
      if (!Number.isFinite(offset) || offsetAt(clock, wall - offset * minute_ms) !== offset)
        continue;
      if (Number.isInteger(offset) && Math.abs(offset) <= 840) offsets.push(offset);
      else issue = 'unsupported';
    }
    offsets.sort((a, b) => b - a);
    if (offsets.length) issue = undefined;
    else issue ??= 'gap';
  }
  // When checking in during the second occurrence, keep the current instant. An entered
  // ambiguous time defaults to the first occurrence.
  let offset: number | undefined =
    entered_time === undefined && local_time === local_now && offsets.includes(now_offset)
      ? now_offset
      : offsets.at(0);
  // A journal is a record of the actual instant, even if zone rules have since changed.
  // For an unavailable recorded zone, the stored offset still permits editing the visit.
  const unchanged =
    recorded && local_time === toVisitInput(recorded.visited_at, recorded.utc_offset_minutes);
  const unavailable_recorded_zone = !!recorded?.time_zone && !clock;
  if (recorded?.time_zone && (unchanged || unavailable_recorded_zone)) {
    offset = recorded.utc_offset_minutes;
    issue = undefined;
  }
  const resolved_zone = clock ? time_zone : unchanged ? recorded?.time_zone : undefined;
  // An occurrence belongs to one wall time in one zone. Later date or city edits use the
  // corresponding zone rules again, including dates on the other side of a clock change.
  if (
    occurrence?.local_time === local_time &&
    occurrence.time_zone === resolved_zone &&
    !unavailable_recorded_zone &&
    offsets.length === 2 &&
    offsets.includes(occurrence.offset)
  ) {
    offset = occurrence.offset;
  }
  return {
    local_time,
    offset,
    offsets,
    issue,
    unavailable_recorded_zone,
    time_zone: resolved_zone,
  };
}
