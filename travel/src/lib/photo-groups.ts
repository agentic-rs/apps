import { max_photos_per_check_in } from './model';
import type { PhotoMetadata } from './photo-metadata';
import type { Coordinates, PhotoAsset } from './types';

export interface EventPhoto {
  asset: PhotoAsset;
  metadata: PhotoMetadata;
}

export interface PhotoGroup extends PhotoMetadata {
  photos: PhotoAsset[];
}

const max_gap_ms = 2 * 60 * 60 * 1000;
const max_distance_km = 1;

function distanceKm(a: Coordinates, b: Coordinates): number {
  const radians = Math.PI / 180;
  const delta_lat = (b.latitude - a.latitude) * radians;
  const delta_lon = (b.longitude - a.longitude) * radians;
  const haversine =
    Math.sin(delta_lat / 2) ** 2 +
    Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(delta_lon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

export function groupEventPhotos(photos: readonly EventPhoto[]): PhotoGroup[] {
  // Compare absolute instants and unzoned camera clocks in separate passes.
  // Undated photos keep their selection order and require individual review.
  const sorted = photos
    .map(({ asset, metadata }) => {
      const { local_time, utc_offset_minutes } = metadata;
      const clock = local_time === null ? 2 : utc_offset_minutes === null ? 1 : 0;
      const time = local_time
        ? Date.parse(`${local_time}:00Z`) - (utc_offset_minutes ?? 0) * 60_000
        : 0;
      return { asset, metadata, clock, time };
    })
    .sort((a, b) => a.clock - b.clock || a.time - b.time);

  const groups: PhotoGroup[] = [];
  for (const [index, photo] of sorted.entries()) {
    const { asset, metadata, time, clock } = photo;
    const group = groups.at(-1);
    const previous = sorted[index - 1];
    if (
      !group ||
      !metadata.local_time ||
      clock !== previous.clock ||
      group.local_time?.slice(0, 10) !== metadata.local_time.slice(0, 10) ||
      time - previous.time > max_gap_ms ||
      group.photos.length >= max_photos_per_check_in ||
      (group.location &&
        metadata.location &&
        distanceKm(group.location, metadata.location) > max_distance_km)
    ) {
      groups.push({ ...metadata, photos: [asset] });
    } else {
      group.photos.push(asset);
      group.location ??= metadata.location;
    }
  }
  return groups;
}
