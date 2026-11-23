import { daysBetween, formatVisitDate, formatVisitTime, toVisitInput } from '../lib/dates';
import { formatEntryCount, visitTitle } from '../lib/model';
import { distanceKm, formatDistance } from '../lib/distance';
import type { continuingStays } from '../lib/hotel-stays';
import { stop_kind_labels } from '../lib/types';
import type { CheckIn, PhotoAsset, Place, PlannedStop, TravelPlatform, Trip } from '../lib/types';
import { Icon } from './Icon';
import { VisitCard } from './VisitCard';
import { Photo } from './Photo';
import { StopOrderButtons, useStopOrder, type MoveStop } from './StopOrderButtons';
import '../itinerary.css';

const day_heading = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

interface ItineraryDayProps {
  day: string;
  day_cities: string;
  trip: Trip;
  stops: PlannedStop[];
  continuing_stays: ReturnType<typeof continuingStays>;
  visits: CheckIn[];
  trip_visits: CheckIn[];
  places: Place[];
  platform: TravelPlatform;
  onAddStop(category: 'sight' | 'stay'): void;
  onOpenMap(): void;
  onEditStop(stop: PlannedStop): void;
  onMoveStop: MoveStop;
  onCheckIn(stop?: PlannedStop): void;
  onPhotoEvents(): void;
  onOpenVisit(id: string): void;
  onPhoto(asset: PhotoAsset, caption: string): void;
}

export function ItineraryDay({
  day,
  day_cities,
  trip,
  stops,
  continuing_stays,
  visits,
  trip_visits,
  places,
  platform,
  onAddStop,
  onOpenMap,
  onEditStop,
  onMoveStop,
  onCheckIn,
  onPhotoEvents,
  onOpenVisit,
  onPhoto,
}: ItineraryDayProps) {
  const { moving, move_error, reorder } = useStopOrder(onMoveStop);
  const day_label = day_heading.format(new Date(day + 'T00:00:00Z'));
  const by_place = new Map(places.map((place) => [place.id, place]));
  const by_stop = new Map(stops.map((stop) => [stop.id, [] as CheckIn[]]));
  for (const visit of trip_visits) {
    if (visit.stop_id) by_stop.get(visit.stop_id)?.push(visit);
  }
  const journal_entries = visits.filter((visit) => !visit.stop_id || !by_stop.has(visit.stop_id));

  function renderVisit(visit: CheckIn, stop?: PlannedStop) {
    const place = visit.place_id ? by_place.get(visit.place_id) : undefined;
    const title = visitTitle(visit, place);
    if (stop) {
      const photo = visit.photos[0];
      return (
        <article className="linked-entry" key={visit.id}>
          <button
            className="linked-entry-copy"
            aria-label={visit.title ? `Open event ${title}` : `Open check-in at ${title}`}
            onClick={() => onOpenVisit(visit.id)}
          >
            <span className="linked-entry-time">
              <Icon name="check" size={14} />
              Checked in · {formatVisitTime(visit.visited_at, visit.utc_offset_minutes)}
            </span>
            {title !== stop.title && <strong>{title}</strong>}
            {visit.notes && <span className="linked-entry-notes">{visit.notes}</span>}
            {visit.photos.length > 1 && <small>{visit.photos.length} photos</small>}
          </button>
          {photo && (
            <div className="visit-photos">
              <Photo
                photo={photo}
                platform={platform}
                alt={`${title}, photo 1`}
                onOpen={() => onPhoto(photo, title)}
              />
            </div>
          )}
        </article>
      );
    }
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
  }

  return (
    <section className="itinerary-day" aria-label="Day itinerary">
      <header className="itinerary-day-heading">
        <div className="day-plan-tools">
          <div className="day-summary">
            {day_cities && (
              <time className="day-location-date" dateTime={day}>
                {day_label}
              </time>
            )}
            <h2>{day_cities || <time dateTime={day}>{day_label}</time>}</h2>
            {(stops.length > 0 || visits.length > 0) && (
              <p>
                {stops.length > 0 && `${stops.length} ${stops.length === 1 ? 'stop' : 'stops'}`}
                {stops.length > 0 && visits.length > 0 && ' · '}
                {visits.length > 0 && formatEntryCount(visits.length)}
              </p>
            )}
          </div>
          <button
            type="button"
            className="day-map-button"
            onClick={onOpenMap}
            aria-label="Open day map"
          >
            <Icon name="map" size={20} />
            Map
          </button>
        </div>
        <div className="day-place-actions">
          <button type="button" className="primary" onClick={() => onAddStop('sight')}>
            <Icon name="landmark" size={18} /> Add stop
          </button>
          <button type="button" className="secondary" onClick={() => onAddStop('stay')}>
            <Icon name="bed" size={18} /> Add hotel
          </button>
        </div>
      </header>
      {continuing_stays.map(({ stop, label }) => (
        <button
          type="button"
          className="ongoing-stay"
          key={stop.id}
          onClick={() => onEditStop(stop)}
        >
          <Icon name="bed" size={17} />
          <span>{label}</span>
          <Icon name="next" size={15} />
        </button>
      ))}
      {move_error && (
        <p className="form-error" role="alert">
          {move_error}
        </p>
      )}
      {stops.length > 0 ? (
        <ol className="itinerary-stops" aria-label="Planned stops">
          {stops.map((stop, index) => {
            const linked = by_stop.get(stop.id)!;
            const next_position = stops[index + 1]?.position;
            const nights = stop.checkout_date ? daysBetween(stop.day, stop.checkout_date) : 0;
            return (
              <li key={stop.id}>
                <span className="itinerary-stop-number" aria-hidden="true">
                  {index + 1}
                </span>
                <div className="itinerary-stop-body">
                  <div className="itinerary-stop-meta">
                    <span>{stop_kind_labels[stop.kind]}</span>
                    {stop.city && <span>{stop.city}</span>}
                    {stop.checkout_date && (
                      <span>
                        {nights} {nights === 1 ? 'night' : 'nights'}
                        {' · Until '}
                        <time dateTime={stop.checkout_date}>
                          {formatVisitDate(stop.checkout_date + 'T00:00:00Z', 0)}
                        </time>
                      </span>
                    )}
                    {stop.time && <time dateTime={stop.day + 'T' + stop.time}>{stop.time}</time>}
                  </div>
                  <h3>
                    <button
                      type="button"
                      className="itinerary-stop-title"
                      aria-label={`Edit ${stop.title}`}
                      onClick={() => onEditStop(stop)}
                    >
                      <span>{stop.title}</span>
                      <Icon name="edit" size={15} />
                    </button>
                  </h3>
                  {stop.notes && <p className="itinerary-stop-notes">{stop.notes}</p>}
                  <div className="itinerary-stop-tools">
                    <button
                      type="button"
                      className="itinerary-check-in"
                      aria-label={`Check in at ${stop.title}`}
                      onClick={() => onCheckIn(stop)}
                    >
                      <Icon name="pin" size={15} /> Check in
                    </button>
                    <StopOrderButtons
                      stop={stop}
                      index={index}
                      count={stops.length}
                      moving={moving}
                      onMove={reorder}
                    />
                  </div>
                  {linked.length > 0 && (
                    <div
                      className="itinerary-linked"
                      role="group"
                      aria-label={`Journal at ${stop.title}`}
                    >
                      {linked.map((visit) => {
                        const recorded_day = toVisitInput(
                          visit.visited_at,
                          visit.utc_offset_minutes,
                        ).slice(0, 10);
                        if (recorded_day === day) return renderVisit(visit, stop);
                        return (
                          <div key={visit.id} className="itinerary-cross-day">
                            <p>
                              Recorded{' '}
                              <time dateTime={recorded_day}>
                                {formatVisitDate(visit.visited_at, visit.utc_offset_minutes)}
                              </time>
                            </p>
                            {renderVisit(visit, stop)}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                {stop.position && next_position && (
                  <span className="itinerary-leg">
                    {formatDistance(distanceKm(stop.position, next_position))} straight line to next
                    stop
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        !continuing_stays.length && (
          <p className="itinerary-empty">No stops planned for this day.</p>
        )
      )}
      {stops.some(
        (stop) => stop.directory_ref && stop.directory_ref.provider !== 'ourairports',
      ) && (
        <small className="itinerary-place-credit">
          {stops.some((stop) => stop.directory_ref?.provider === 'geoapify') && (
            <>
              <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">
                Geoapify
              </a>{' '}
              ·{' '}
            </>
          )}
          ©{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            OpenStreetMap contributors
          </a>
        </small>
      )}
      <section className="itinerary-journal" aria-label="Day journal">
        <h3>Day journal</h3>
        <div className="itinerary-journal-actions">
          <button type="button" className="secondary" onClick={() => onCheckIn()}>
            <Icon name="pin" size={16} /> New check-in
          </button>
          <button type="button" className="secondary" onClick={onPhotoEvents}>
            <Icon name="photo" size={16} /> Events from photos
          </button>
        </div>
        {journal_entries.map((visit) => renderVisit(visit))}
      </section>
    </section>
  );
}
