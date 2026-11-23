import { SearchField } from './SearchField';
import type { CheckIn, Journal, TravelPlatform, Trip } from '../lib/types';
import { formatTripDates } from '../lib/dates';
import { cityKey, tripCitySummary } from '../lib/cities';
import { Icon } from './Icon';
import { Photo } from './Photo';

export function TripLibrary({
  journal,
  platform,
  search,
  onSearch,
  onOpen,
  onCreate,
}: {
  journal: Journal;
  platform: TravelPlatform;
  search: string;
  onSearch(value: string): void;
  onOpen(trip: Trip): void;
  onCreate(): void;
}) {
  const terms = cityKey(search).split(' ').filter(Boolean);
  const trips = journal.trips
    .filter((trip) => {
      const text = cityKey([trip.title, ...(trip.cities ?? [])].join(' '));
      return terms.every((term) => text.includes(term));
    })
    .sort((a, b) => (b.start_date || b.created_at).localeCompare(a.start_date || a.created_at));
  const counts = new Map(journal.trips.map((trip) => [trip.id, { stops: 0, entries: 0 }]));
  const covers = new Map<string, CheckIn>();
  for (const stop of journal.stops) counts.get(stop.trip_id)!.stops++;
  for (const entry of journal.check_ins) {
    counts.get(entry.trip_id)!.entries++;
    const latest = covers.get(entry.trip_id);
    if (entry.photos.length && (!latest || latest.visited_at < entry.visited_at))
      covers.set(entry.trip_id, entry);
  }
  const Title = platform.native ? 'h1' : 'h2';
  return (
    <section className="trip-library">
      <div className="library-heading">
        <Title>Your trips</Title>
        {journal.trips.length > 0 && (
          <button className="primary" onClick={onCreate}>
            <Icon name="plus" size={17} />
            New trip
          </button>
        )}
      </div>
      {journal.trips.length > 0 && (
        <SearchField
          label="Search trips"
          placeholder="Search trips or cities"
          clear_label="Clear trip search"
          value={search}
          onChange={onSearch}
        />
      )}
      {journal.trips.length === 0 ? (
        <button aria-label="New trip" className="new-trip-row" onClick={onCreate}>
          <span className="new-trip-symbol">
            <Icon name="plus" size={23} />
          </span>
          <span>
            <strong>New trip</strong>
            <small>Choose a city to open its itinerary.</small>
          </span>
          <Icon name="next" size={18} />
        </button>
      ) : trips.length === 0 ? (
        <p className="library-no-results" role="status">
          No matching trips.
        </p>
      ) : (
        <ul className="trip-shelf">
          {trips.map((trip) => {
            const { stops, entries } = counts.get(trip.id)!;
            const cover = covers.get(trip.id)?.photos[0];
            const route = tripCitySummary(trip);
            const dates = formatTripDates(trip.start_date, trip.end_date);
            const activity = [
              stops > 0 && `${stops} ${stops === 1 ? 'stop' : 'stops'}`,
              entries > 0 && `${entries} journal ${entries === 1 ? 'entry' : 'entries'}`,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <li key={trip.id} className="trip-library-row">
                <div className="trip-thumb" aria-hidden="true">
                  {cover ? (
                    <Photo photo={cover} platform={platform} alt="" />
                  ) : (
                    <Icon name="map" size={25} />
                  )}
                </div>
                <button
                  className="trip-cover"
                  aria-label={`Open trip ${trip.title}`}
                  aria-description={[route, dates, activity].filter(Boolean).join('. ')}
                  onClick={() => onOpen(trip)}
                >
                  <strong>{trip.title}</strong>
                  {route && <span className="trip-cities">{route}</span>}
                  <span>{dates}</span>
                  {activity && <small>{activity}</small>}
                  <Icon name="next" size={17} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
