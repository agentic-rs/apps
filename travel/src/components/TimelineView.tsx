import { formatVisitDate, toVisitInput } from '../lib/dates';
import { formatEntryCount, visitTitle } from '../lib/model';
import type { CheckIn, PhotoAsset, Place, TravelPlatform, Trip } from '../lib/types';
import { SearchField } from './SearchField';
import { VisitCard } from './VisitCard';

export function TimelineView({
  visits,
  places,
  trip,
  platform,
  search,
  onSearch,
  onOpenVisit,
  onPhoto,
}: {
  visits: CheckIn[];
  places: Place[];
  trip: Trip;
  platform: TravelPlatform;
  search: string;
  onSearch(value: string): void;
  onOpenVisit(id: string): void;
  onPhoto(photo: PhotoAsset, caption: string): void;
}) {
  const by_place = new Map(places.map((place) => [place.id, place]));
  const query = search.trim().toLocaleLowerCase();
  const groups = new Map<string, CheckIn[]>();
  let count = 0;
  for (const visit of visits) {
    const place = visit.place_id ? by_place.get(visit.place_id) : undefined;
    if (
      query &&
      ![visit.title, place?.name, place?.locality, visit.notes]
        .join(' ')
        .toLocaleLowerCase()
        .includes(query)
    )
      continue;
    const day = toVisitInput(visit.visited_at, visit.utc_offset_minutes).slice(0, 10);
    const entries = groups.get(day) ?? [];
    entries.push(visit);
    groups.set(day, entries);
    count++;
  }
  return (
    <section className="timeline-view" aria-label="Travel timeline">
      {visits.length > 0 && (
        <div className="timeline-tools">
          <SearchField
            label="Search timeline"
            placeholder="Search journal"
            clear_label="Clear search"
            value={search}
            onChange={onSearch}
          />
          <span className="timeline-count" role="status">
            {formatEntryCount(count)}
          </span>
        </div>
      )}
      {count === 0 ? (
        <p className="journal-empty">
          {query ? 'No matching entries.' : 'Your check-ins and photo events will appear here.'}
        </p>
      ) : (
        <div className="timeline-list">
          {[...groups.keys()]
            .sort()
            .reverse()
            .map((day) => {
              const entries = groups.get(day)!;
              return (
                <section key={day}>
                  <h3 className="timeline-day">
                    <span />
                    {formatVisitDate(entries[0].visited_at, entries[0].utc_offset_minutes)}
                  </h3>
                  {entries.map((visit) => {
                    const place = visit.place_id ? by_place.get(visit.place_id) : undefined;
                    return (
                      <VisitCard
                        key={visit.id}
                        visit={visit}
                        place={place}
                        trip={trip}
                        platform={platform}
                        onOpen={() => onOpenVisit(visit.id)}
                        onPhoto={(asset) => onPhoto(asset, visitTitle(visit, place))}
                      />
                    );
                  })}
                </section>
              );
            })}
        </div>
      )}
    </section>
  );
}
