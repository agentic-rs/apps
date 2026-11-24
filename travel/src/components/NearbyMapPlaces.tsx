import { stop_kind_labels, type PlannedStop } from '../lib/types';
import { Icon } from './Icon';

export function mapStopDetail(stop: PlannedStop, day: string, number?: number, city?: string) {
  const hotel_status =
    number !== undefined
      ? 'Check-in'
      : stop.checkout_date === day
        ? 'Check-out'
        : 'Staying overnight';
  return [
    stop.kind === 'stay' ? hotel_status : stop_kind_labels[stop.kind],
    city,
    number !== undefined && stop.time,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function NearbyMapPlaces({
  stops,
  numbers,
  day,
  nearbyCity,
  onChoose,
}: {
  stops: readonly PlannedStop[];
  numbers: ReadonlyMap<string, number>;
  day: string;
  nearbyCity(stop: PlannedStop): string | undefined;
  onChoose(stop: PlannedStop): void;
}) {
  return (
    <ul className="map-selected-visits map-nearby-choices" aria-label="Places in this map area">
      {stops.map((stop) => {
        const number = numbers.get(stop.id);
        const detail = mapStopDetail(stop, day, number, nearbyCity(stop));
        const description = [
          number !== undefined && `Stop ${number}`,
          stop.kind === 'stay' && 'Hotel',
          detail,
        ]
          .filter(Boolean)
          .join('. ');
        return (
          <li key={stop.id}>
            <button
              className="map-stop-row"
              type="button"
              data-map-choice={stop.id}
              aria-label={`Show ${stop.title} on map`}
              aria-description={description}
              onClick={() => onChoose(stop)}
            >
              {number === undefined ? (
                <span className="map-stay-symbol">
                  <Icon name="bed" size={18} />
                </span>
              ) : (
                <span className="map-stop-number">{number}</span>
              )}
              <span className="map-stop-copy">
                <strong>{stop.title}</strong>
                <small>{detail}</small>
              </span>
              <Icon name="next" size={15} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
