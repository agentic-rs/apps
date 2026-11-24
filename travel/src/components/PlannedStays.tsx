import { useId, useMemo } from 'react';
import { cityIndicesOnDay } from '../lib/city-days';
import { formatTripDates } from '../lib/dates';
import type { staysInRange } from '../lib/hotel-stays';
import { plannedStopCityIndex, searchCityLabel } from '../lib/planned-stop-search';
import type { Trip } from '../lib/types';
import { searchCities, useSearchCityLocations } from '../lib/use-search-cities';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import '../planned-stays.css';

type OverlappingStays = ReturnType<typeof staysInRange>;

function StayDate({ day }: { day: string }) {
  return <time dateTime={day}>{formatTripDates(day, '')}</time>;
}

function SavedStay({ trip, stay }: { trip: Trip; stay: OverlappingStays[number] }) {
  const { stop, first_night, last_night } = stay;
  const heading = useId();
  // A continuing stay belongs to the city of its original check-in, even after a transfer.
  const scheduled = useMemo(
    () => searchCities(trip, cityIndicesOnDay(trip, stop.day)),
    [trip, stop.day],
  );
  const needs_centers = !stop.city && (!!stop.city_id || (!!stop.position && scheduled.length > 1));
  const { cities } = useSearchCityLocations(scheduled, needs_centers);
  const index = plannedStopCityIndex(stop, cities, stop.day);
  const city = index === undefined ? stop.city : searchCityLabel(cities, index);
  const location = stop.directory_ref?.subtitle;
  return (
    <article className="planned-stay" aria-labelledby={heading}>
      <header>
        <span className="planned-stay-icon">
          <Icon name="bed" size={21} />
        </span>
        <div>
          <h3 id={heading}>{stop.title}</h3>
          {city && <p>{city}</p>}
        </div>
      </header>
      <dl>
        <div className="planned-stay-endpoint">
          <dt>Check-in</dt>
          <dd>
            <StayDate day={stop.day} />
            {stop.time && <> · {stop.time}</>}
          </dd>
        </div>
        <div className="planned-stay-endpoint">
          <dt>Check-out</dt>
          <dd>{stop.checkout_date ? <StayDate day={stop.checkout_date} /> : 'Open'}</dd>
        </div>
        <div>
          <dt>{first_night === last_night ? 'Shared night' : 'Shared nights'}</dt>
          <dd>
            <StayDate day={first_night} />
            {first_night !== last_night && (
              <>
                {' '}
                – <StayDate day={last_night} />
              </>
            )}
          </dd>
        </div>
        {location && location !== city && (
          <div>
            <dt>Location</dt>
            <dd>{location}</dd>
          </div>
        )}
        {stop.notes && (
          <div>
            <dt>Notes</dt>
            <dd>{stop.notes}</dd>
          </div>
        )}
      </dl>
    </article>
  );
}

export function PlannedStays({
  trip,
  overlaps,
  hotel,
  check_in,
  check_out,
  onClose,
}: {
  trip: Trip;
  overlaps: OverlappingStays;
  hotel?: { title: string; city?: string };
  check_in: string;
  check_out: string;
  onClose(): void;
}) {
  const proposed_heading = useId();
  return (
    <Dialog title="Planned stays" back_label="Back to stay dates" onDismiss={onClose} full_screen>
      <div className="planned-stays-scroll" tabIndex={0} role="region" aria-label="Stay details">
        <div className="planned-stays-list">
          <section className="proposed-stay" aria-labelledby={proposed_heading}>
            <h3 id={proposed_heading}>Proposed stay</h3>
            {hotel && <strong>{hotel.title}</strong>}
            <p>
              {hotel?.city && <>{hotel.city} · </>}
              {formatTripDates(check_in, check_out)}
              {!check_out && ' · Open check-out'}
            </p>
          </section>
          {overlaps.map((stay) => (
            <SavedStay key={stay.stop.id} stay={stay} trip={trip} />
          ))}
        </div>
      </div>
    </Dialog>
  );
}
