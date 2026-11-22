import type { Journal, Trip } from '../lib/types';
import { formatTripDates } from '../lib/dates';
import { Icon } from './Icon';

export function TripLibrary({
  journal,
  onOpen,
  onCreate,
}: {
  journal: Journal;
  onOpen(trip: Trip): void;
  onCreate(): void;
}) {
  const trips = [...journal.trips].sort((a, b) =>
    (b.start_date || b.created_at).localeCompare(a.start_date || a.created_at),
  );
  const counts = new Map(trips.map((trip) => [trip.id, { stops: 0, entries: 0 }]));
  for (const stop of journal.stops) counts.get(stop.trip_id)!.stops++;
  for (const entry of journal.check_ins) counts.get(entry.trip_id)!.entries++;

  if (!trips.length)
    return (
      <section className="trip-library empty-library">
        <Icon name="map" size={42} />
        <h2>Plan your first trip</h2>
        <p>Pick your dates and add stops to each day. Keep photos and check-ins as you go.</p>
        <button className="primary" onClick={onCreate}>
          <Icon name="plus" size={17} />
          New trip
        </button>
      </section>
    );
  return (
    <section className="trip-library">
      <div className="library-heading">
        <h2>Your trips</h2>
        <button className="primary" onClick={onCreate}>
          <Icon name="plus" size={17} />
          New trip
        </button>
      </div>
      <ul className="trip-shelf">
        {trips.map((trip) => {
          const { stops, entries } = counts.get(trip.id)!;
          return (
            <li key={trip.id}>
              <button
                className="trip-cover"
                aria-label={`Open trip ${trip.title}`}
                onClick={() => onOpen(trip)}
              >
                <span className="trip-cover-dates">
                  {formatTripDates(trip.start_date, trip.end_date)}
                </span>
                <strong>{trip.title}</strong>
                {trip.description && (
                  <span className="trip-cover-description">{trip.description}</span>
                )}
                <span className="trip-cover-footer">
                  <span>
                    {stops} {stops === 1 ? 'stop' : 'stops'} · {entries} journal{' '}
                    {entries === 1 ? 'entry' : 'entries'}
                  </span>
                  <Icon name="arrow" size={18} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
