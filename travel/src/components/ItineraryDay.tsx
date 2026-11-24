import { useLayoutEffect, useMemo, useRef } from 'react';
import { daysBetween, formatVisitDate, formatVisitTime, toVisitInput } from '../lib/dates';
import { formatEntryCount, visitTitle } from '../lib/model';
import { distanceKm, formatDistance } from '../lib/distance';
import { staysForNight, type ContinuingStay } from '../lib/hotel-stays';
import { searchCityForAnchor } from '../lib/planned-stop-search';
import { searchCities, useSearchCityLocations } from '../lib/use-search-cities';
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
  day_cities: string[];
  trip: Trip;
  stops: PlannedStop[];
  continuing_stays: ContinuingStay[];
  reveal_stop_id: string;
  onReveal(): void;
  visits: CheckIn[];
  trip_visits: CheckIn[];
  places: Place[];
  platform: TravelPlatform;
  onAddStop(category: 'sight' | 'stay', near?: PlannedStop): void;
  onOpenMap(): void;
  onReorderStops(): void;
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
  reveal_stop_id,
  onReveal,
  visits,
  trip_visits,
  places,
  platform,
  onAddStop,
  onOpenMap,
  onReorderStops,
  onEditStop,
  onMoveStop,
  onCheckIn,
  onPhotoEvents,
  onOpenVisit,
  onPhoto,
}: ItineraryDayProps) {
  const { moving, move_error, reorder } = useStopOrder(onMoveStop);
  const cities = useMemo(() => searchCities(trip), [trip]);
  const needs_centers = useMemo(() => {
    if (cities.every((city) => city.location)) return false;
    const needs_city = (stop: PlannedStop) =>
      stop.position && searchCityForAnchor(trip, stop, cities) === undefined;
    return stops.some(needs_city) || continuing_stays.some(({ stop }) => needs_city(stop));
  }, [cities, trip, stops, continuing_stays]);
  const { cities: search_cities } = useSearchCityLocations(cities, needs_centers);
  const saved_button = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (!reveal_stop_id) return;
    // WebKit restores the dialog opener as it closes. Move focus once the itinerary is active.
    const frame = requestAnimationFrame(() => {
      const button = saved_button.current;
      if (button) {
        button.focus({ preventScroll: true });
        const card = button.closest('.itinerary-stop-body') ?? button;
        // A long journal can make the card taller than the viewport. Always keep its title in reach.
        card.scrollIntoView({ block: 'nearest' });
        button.scrollIntoView({ block: 'nearest' });
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          card.animate(
            [
              { backgroundColor: 'var(--apell-primary-soft)' },
              { backgroundColor: getComputedStyle(card).backgroundColor },
            ],
            { duration: 900, easing: 'ease-out' },
          );
        }
      }
      onReveal();
    });
    return () => cancelAnimationFrame(frame);
  }, [reveal_stop_id, onReveal]);
  const day_label = day_heading.format(new Date(day + 'T00:00:00Z'));
  const city_route = day_cities.join(' → ');
  const overnight_city = day_cities.at(-1);
  const needs_overnight_stay =
    stops.length > 0 &&
    (!trip.start_date || day >= trip.start_date) &&
    (!trip.end_date || day < trip.end_date) &&
    staysForNight([...stops, ...continuing_stays.map(({ stop }) => stop)], day).length === 0;
  const by_place = new Map(places.map((place) => [place.id, place]));
  const by_stop = new Map(stops.map((stop) => [stop.id, [] as CheckIn[]]));
  for (const visit of trip_visits) {
    if (visit.stop_id) by_stop.get(visit.stop_id)?.push(visit);
  }
  // The arrival card keeps the whole stay's journal. Later days show only that day's entries.
  const by_stay = new Map(continuing_stays.map(({ stop }) => [stop.id, [] as CheckIn[]]));
  const journal_entries: CheckIn[] = [];
  for (const visit of visits) {
    const stay_entries = visit.stop_id && by_stay.get(visit.stop_id);
    if (stay_entries) stay_entries.push(visit);
    else if (!visit.stop_id || !by_stop.has(visit.stop_id)) journal_entries.push(visit);
  }

  function openPicker(button: HTMLButtonElement, category: 'sight' | 'stay', near?: PlannedStop) {
    // Touch WebKit needs an explicit opener to restore focus when the picker closes.
    button.focus({ preventScroll: true });
    onAddStop(category, near);
  }

  function nearbyButton(stop: PlannedStop) {
    if (!stop.position || !['stay', 'sight', 'transport'].includes(stop.kind)) return null;
    if (searchCityForAnchor(trip, stop, search_cities) === undefined) return null;
    const from_hotel = stop.kind === 'stay';
    const label = from_hotel ? 'sights' : 'hotels';
    return (
      <button
        type="button"
        className="itinerary-nearby"
        aria-label={`Find ${label} near ${stop.title}`}
        onClick={(event) => openPicker(event.currentTarget, from_hotel ? 'sight' : 'stay', stop)}
      >
        <Icon name={from_hotel ? 'landmark' : 'bed'} size={16} />
        Nearby {label}
      </button>
    );
  }

  function openCheckIn(button: HTMLButtonElement, stop?: PlannedStop) {
    button.focus({ preventScroll: true });
    onCheckIn(stop);
  }

  function renderVisit(visit: CheckIn, stop?: PlannedStop) {
    const place = visit.place_id ? by_place.get(visit.place_id) : undefined;
    const title = visitTitle(visit, place);
    if (stop) {
      const photo = visit.photos[0];
      const journal_entry = stop.kind === 'stay' || Boolean(visit.title);
      return (
        <article className="linked-entry" key={visit.id}>
          <button
            className="linked-entry-copy"
            aria-label={visit.title ? `Open event ${title}` : `Open check-in at ${title}`}
            onClick={() => onOpenVisit(visit.id)}
          >
            <span className="linked-entry-time">
              <Icon name={journal_entry ? 'book' : 'check'} size={14} />
              {journal_entry ? 'Journal entry' : 'Checked in'} ·{' '}
              {formatVisitTime(visit.visited_at, visit.utc_offset_minutes)}
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
            {city_route && (
              <time className="day-location-date" dateTime={day}>
                {day_label}
              </time>
            )}
            <h2>{city_route || <time dateTime={day}>{day_label}</time>}</h2>
            {(stops.length > 0 || visits.length > 0) && (
              <p>
                {stops.length > 0 && `${stops.length} ${stops.length === 1 ? 'stop' : 'stops'}`}
                {stops.length > 0 && visits.length > 0 && ' · '}
                {visits.length > 0 && formatEntryCount(visits.length)}
              </p>
            )}
          </div>
          <div className="day-route-actions">
            {stops.length >= 2 && (
              <button
                type="button"
                aria-label="Reorder stops"
                aria-haspopup="dialog"
                title="Reorder stops"
                disabled={moving}
                onClick={onReorderStops}
              >
                <Icon name="reorder" size={20} />
              </button>
            )}
            <button type="button" onClick={onOpenMap} aria-label="Open day map">
              <Icon name="map" size={20} />
              Map
            </button>
          </div>
        </div>
        <div className="day-place-actions">
          <button
            type="button"
            className="primary"
            onClick={(event) => openPicker(event.currentTarget, 'sight')}
          >
            <Icon name="landmark" size={18} /> Add stop
          </button>
          <button
            type="button"
            className="secondary"
            onClick={(event) => openPicker(event.currentTarget, 'stay')}
          >
            <Icon name="bed" size={18} /> Add hotel
          </button>
        </div>
      </header>
      {continuing_stays.map(({ stop, label }) => {
        const entries = by_stay.get(stop.id)!;
        const nearby = nearbyButton(stop);
        return (
          <div className="ongoing-stay" key={stop.id}>
            <div className={`ongoing-stay-actions${nearby ? ' with-nearby' : ''}`}>
              <button
                type="button"
                ref={stop.id === reveal_stop_id ? saved_button : undefined}
                aria-label={label}
                aria-description={stop.city}
                onClick={() => onEditStop(stop)}
              >
                <Icon name="bed" size={17} />
                <span>
                  {label}
                  {stop.city && <small>{stop.city}</small>}
                </span>
                <Icon name="next" size={15} />
              </button>
              {nearby}
              <button
                type="button"
                className="stay-add-entry"
                aria-label={`Add journal entry at ${stop.title}`}
                onClick={(event) => openCheckIn(event.currentTarget, stop)}
              >
                <Icon name="plus" size={15} /> Add entry
              </button>
            </div>
            {entries.length > 0 && (
              <div className="stay-journal" role="group" aria-label={`Journal at ${stop.title}`}>
                {entries.map((visit) => renderVisit(visit, stop))}
              </div>
            )}
          </div>
        );
      })}
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
                      ref={stop.id === reveal_stop_id ? saved_button : undefined}
                      aria-label={`Edit ${stop.title}`}
                      aria-description={`Stop ${index + 1} of ${stops.length} · ${stop_kind_labels[stop.kind]}`}
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
                      onClick={(event) => openCheckIn(event.currentTarget, stop)}
                    >
                      <Icon name="pin" size={15} /> Check in
                    </button>
                    {nearbyButton(stop)}
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
      {needs_overnight_stay && (
        <button
          type="button"
          className="itinerary-add-stay"
          aria-label="Add overnight stay"
          aria-description={overnight_city && `Search hotels in ${overnight_city}`}
          onClick={(event) => openPicker(event.currentTarget, 'stay')}
        >
          <Icon name="bed" size={19} />
          <span>
            Add overnight stay
            {overnight_city && <small>{overnight_city}</small>}
          </span>
          <Icon name="plus" size={18} />
        </button>
      )}
      <section className="itinerary-journal" aria-label="Day journal">
        <h3>Day journal</h3>
        <div className="itinerary-journal-actions">
          <button
            type="button"
            className="secondary"
            onClick={(event) => openCheckIn(event.currentTarget)}
          >
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
