import { formatVisitDate, toVisitInput } from '../lib/dates';
import type { CheckIn, PhotoAsset, Place, TravelPlatform, Trip } from '../lib/types';
import { Icon } from './Icon';
import { VisitCard } from './VisitCard';

export function TimelineView({
  visits,
  places,
  trips,
  platform,
  search,
  has_trips,
  onSearch,
  onCreate,
  onOpenVisit,
  onPhoto,
}: {
  visits: CheckIn[];
  places: Place[];
  trips: Trip[];
  platform: TravelPlatform;
  search: string;
  has_trips: boolean;
  onSearch(value: string): void;
  onCreate(): void;
  onOpenVisit(id: string): void;
  onPhoto(photo: PhotoAsset, caption: string): void;
}) {
  const by_place = new Map(places.map((place) => [place.id, place]));
  const by_trip = new Map(trips.map((trip) => [trip.id, trip]));
  const filtered = visits.filter((visit) => {
    const place = by_place.get(visit.place_id)!;
    return `${place.name} ${place.locality} ${visit.notes} ${by_trip.get(visit.trip_id)!.title}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase());
  });
  return (
    <section className="timeline-view" aria-label="Travel timeline">
      <div className="timeline-tools">
        <label className="search-box">
          <Icon name="search" size={18} />
          <input
            aria-label="Search check-ins"
            placeholder="Find a place or a memory"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
          />
          {search && (
            <button className="icon-button" aria-label="Clear search" onClick={() => onSearch('')}>
              <Icon name="close" size={16} />
            </button>
          )}
        </label>
        <span className="timeline-count">
          {filtered.length} check-in{filtered.length === 1 ? '' : 's'}
        </span>
      </div>
      {filtered.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">
            <Icon name={search ? 'search' : 'pin'} size={32} />
          </span>
          <h2>{search ? 'No matching moments' : 'Your next stop starts here'}</h2>
          <p>
            {search
              ? 'Try a place name or a word from your notes.'
              : 'Check in, keep a photo, and remember where you were.'}
          </p>
          {!search && (
            <button className="primary" onClick={onCreate}>
              <Icon name="plus" size={18} />
              {has_trips ? 'Add a check-in' : 'Start a trip'}
            </button>
          )}
        </div>
      ) : (
        <div className="timeline-list">
          {filtered.map((visit, index) => {
            const day = toVisitInput(visit.visited_at, visit.utc_offset_minutes).slice(0, 10);
            const previous = filtered[index - 1];
            const show_day =
              !previous ||
              toVisitInput(previous.visited_at, previous.utc_offset_minutes).slice(0, 10) !== day;
            const place = by_place.get(visit.place_id)!;
            return (
              <div className="timeline-entry" key={visit.id}>
                {show_day && (
                  <h2 className="timeline-day">
                    <span />
                    {formatVisitDate(visit.visited_at, visit.utc_offset_minutes)}
                  </h2>
                )}
                <VisitCard
                  visit={visit}
                  place={place}
                  trip={by_trip.get(visit.trip_id)!}
                  platform={platform}
                  onOpen={() => onOpenVisit(visit.id)}
                  onPhoto={(photo) => onPhoto(photo, place.name)}
                />
              </div>
            );
          })}
          <p className="timeline-end">
            <span />
            The beginning of your story
            <span />
          </p>
        </div>
      )}
    </section>
  );
}
