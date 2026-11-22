import type { Coordinates } from './types';

/** Great-circle distance on a sphere, in kilometres. */
export function distanceKm(a: Coordinates, b: Coordinates): number {
  const radians = Math.PI / 180;
  const delta_lat = (b.latitude - a.latitude) * radians;
  // Wrapping before conversion also makes +180 and −180 exactly coincident.
  const raw_lon = b.longitude - a.longitude;
  const delta_lon =
    (Math.abs(raw_lon) > 180 ? raw_lon - Math.sign(raw_lon) * 360 : raw_lon) * radians;
  const haversine =
    Math.sin(delta_lat / 2) ** 2 +
    Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(delta_lon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(haversine)));
}
const kilometres = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

export function formatDistance(km: number) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${kilometres.format(km)} km`;
}
