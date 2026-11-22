import type { ExpandedTags } from 'exifreader';
import { isCalendarDate } from './dates';
import type { Coordinates } from './types';

export interface PhotoMetadata {
  local_time: string | null;
  utc_offset_minutes: number | null;
  location: Coordinates | null;
}

function captureMinute(value: string): string | null {
  const match = /^(\d{4}):(\d{2}):(\d{2}) ([01]\d|2[0-3]):([0-5]\d):[0-5]\d(?:\.\d+)?$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const date = `${year}-${month}-${day}`;
  return isCalendarDate(date) ? `${date}T${hour}:${minute}` : null;
}

function captureOffset(value: string): number | null {
  const match = /^([+-])(\d{2}):([0-5]\d)$/.exec(value);
  if (!match) return null;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return minutes <= 14 * 60 ? (match[1] === '-' ? -minutes : minutes) : null;
}

function photoLocation(tags: ExpandedTags): Coordinates | null {
  const latitude = tags.gps?.Latitude;
  const longitude = tags.gps?.Longitude;
  const north_south = tags.exif?.GPSLatitudeRef?.value[0];
  const east_west = tags.exif?.GPSLongitudeRef?.value[0];
  if (
    (north_south !== 'N' && north_south !== 'S') ||
    (east_west !== 'E' && east_west !== 'W') ||
    latitude === undefined ||
    !Number.isFinite(latitude) ||
    Math.abs(latitude) > 90 ||
    longitude === undefined ||
    !Number.isFinite(longitude) ||
    Math.abs(longitude) > 180
  )
    return null;
  return { latitude, longitude };
}

/** Read the original file locally. An unzoned camera clock stays a wall time until review. */
export async function readPhotoMetadata(blob: Blob): Promise<PhotoMetadata> {
  const { load } = await import('exifreader');
  const bytes = await blob.arrayBuffer();
  let tags: ExpandedTags;
  try {
    tags = load(bytes, {
      expanded: true,
      includeTags: {
        exif: [
          'DateTimeOriginal',
          'OffsetTimeOriginal',
          'GPSDateStamp',
          'GPSTimeStamp',
          'GPSLatitude',
          'GPSLatitudeRef',
          'GPSLongitude',
          'GPSLongitudeRef',
        ],
        gps: ['Latitude', 'Longitude'],
      },
    });
  } catch {
    // Images with a damaged or unsupported metadata block can still be attached.
    return { local_time: null, utc_offset_minutes: null, location: null };
  }
  const exif = tags.exif;
  const local_time = captureMinute(exif?.DateTimeOriginal?.value[0] ?? '');
  const location = photoLocation(tags);
  if (local_time) {
    return {
      local_time,
      utc_offset_minutes: captureOffset(exif?.OffsetTimeOriginal?.value[0] ?? ''),
      location,
    };
  }
  const gps_time = captureMinute(
    `${exif?.GPSDateStamp?.value[0]} ${exif?.GPSTimeStamp?.description}`,
  );
  return { local_time: gps_time, utc_offset_minutes: gps_time ? 0 : null, location };
}
