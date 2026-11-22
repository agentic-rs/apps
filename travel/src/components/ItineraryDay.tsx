import { useState } from 'react';
import { formatVisitDate, formatVisitTime, toVisitInput } from '../lib/dates';
import { visitTitle } from '../lib/model';
import { distanceKm, formatDistance } from '../lib/distance';
import { stop_kind_labels } from '../lib/types';
import type { CheckIn, PhotoAsset, Place, PlannedStop, TravelPlatform, Trip } from '../lib/types';
import { Icon } from './Icon';
import { VisitCard } from './VisitCard';
import { Photo } from './Photo';
import '../itinerary.css';

const day_heading = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

interface ItineraryDayProps {
  day: string;
  trip: Trip;
  stops: PlannedStop[];
  visits: CheckIn[];
  trip_visits: CheckIn[];
  places: Place[];
  platform: TravelPlatform;
  onAddStop(): void;
  onOpenMap(): void;
  onEditStop(stop: PlannedStop): void;
  onMoveStop(stop: PlannedStop, direction: -1 | 1): Promise<void>;
  onCheckIn(stop?: PlannedStop): void;
  onPhotoEvents(): void;
  onOpenVisit(id: string): void;
  onPhoto(asset: PhotoAsset, caption: string): void;
}

export function ItineraryDay({
  day,
  trip,
  stops,
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
  const [moving, setMoving] = useState(false);
  const [move_error, setMoveError] = useState('');
  const by_place = new Map(places.map((place) => [place.id, place]));
  const by_stop = new Map(stops.map((stop) => [stop.id, [] as CheckIn[]]));
  for (const visit of trip_visits) {
    if (visit.stop_id) by_stop.get(visit.stop_id)?.push(visit);
  }
  const journal_entries = visits.filter((visit) => !visit.stop_id || !by_stop.has(visit.stop_id));

  async function reorder(stop: PlannedStop, direction: -1 | 1) {
    if (moving) return;
    setMoving(true);
    setMoveError('');
    try {
      await onMoveStop(stop, direction);
    } catch (reason) {
      setMoveError(reason instanceof Error ? reason.message : 'Could not change the stop order.');
    } finally {
      setMoving(false);
    }
  }

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
        <div>
          <h2>
            <time dateTime={day}>{day_heading.format(new Date(day + 'T00:00:00Z'))}</time>
          </h2>
          <p>
            {stops.length} planned {stops.length === 1 ? 'stop' : 'stops'}
            {' · '}
            {visits.length} journal {visits.length === 1 ? 'entry' : 'entries'}
          </p>
        </div>
        <div className="day-actions">
          <button
            type="button"
            className="icon-button"
            onClick={onOpenMap}
            aria-label="Open day map"
          >
            <Icon name="map" size={20} />
          </button>
          <button type="button" className="primary" onClick={onAddStop}>
            <Icon name="plus" size={17} /> Add stop
          </button>
        </div>
      </header>
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
            return (
              <li key={stop.id}>
                <span className="itinerary-stop-number" aria-hidden="true">
                  {index + 1}
                </span>
                <div className="itinerary-stop-body">
                  <div className="itinerary-stop-meta">
                    <span>{stop_kind_labels[stop.kind]}</span>
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
                    {stops.length > 1 && (
                      <div className="itinerary-reorder">
                        <button
                          type="button"
                          className="icon-button"
                          disabled={moving || index === 0}
                          aria-label={`Move ${stop.title} earlier`}
                          onClick={() => void reorder(stop, -1)}
                        >
                          <Icon name="arrow" size={16} style={{ transform: 'rotate(-90deg)' }} />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          disabled={moving || index === stops.length - 1}
                          aria-label={`Move ${stop.title} later`}
                          onClick={() => void reorder(stop, 1)}
                        >
                          <Icon name="arrow" size={16} style={{ transform: 'rotate(90deg)' }} />
                        </button>
                      </div>
                    )}
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
        <p className="itinerary-empty">No stops planned for this day.</p>
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
