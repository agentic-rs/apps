import { formatCoordinates } from '../lib/model';
import { formatVisitDate, formatVisitTime } from '../lib/dates';
import type { CheckIn, PhotoAsset, Place, TravelPlatform, Trip } from '../lib/types';
import { Icon } from './Icon';
import { Photo } from './Photo';

export function VisitCard({
  visit,
  place,
  trip,
  platform,
  detail = false,
  onOpen,
  onPhoto,
}: {
  visit: CheckIn;
  place: Place;
  trip: Trip;
  platform: TravelPlatform;
  detail?: boolean;
  onOpen(): void;
  onPhoto(photo: PhotoAsset): void;
}) {
  const photos = detail ? visit.photos : visit.photos.slice(0, 2);
  return (
    <article className={`visit-card${detail ? ' visit-detail' : ''}`}>
      <header className="visit-header">
        <span className="visit-pin">
          <Icon name="pin" size={19} />
        </span>
        <div className="visit-heading">
          {detail ? (
            <h3>{place.name}</h3>
          ) : (
            <button
              className="visit-open"
              aria-label={`Open check-in at ${place.name}`}
              onClick={onOpen}
            >
              <h3>{place.name}</h3>
              <Icon name="arrow" size={17} />
            </button>
          )}
          <p>
            {place.locality || trip.title}
            <span>·</span>
            {formatVisitTime(visit.visited_at, visit.utc_offset_minutes)}
          </p>
        </div>
      </header>
      {visit.notes && (
        <p className={`visit-notes${detail ? '' : ' preview-notes'}`}>{visit.notes}</p>
      )}
      {photos.length > 0 && (
        <div className={`visit-photos${photos.length === 1 ? ' single-photo' : ''}`}>
          {photos.map((photo, index) => (
            <Photo
              key={photo.id}
              photo={photo}
              platform={platform}
              alt={`${place.name}, photo ${index + 1}`}
              onOpen={() => onPhoto(photo)}
            />
          ))}
          {!detail && visit.photos.length > 2 && (
            <button className="more-photos" onClick={onOpen}>
              +{visit.photos.length - 2} photos
            </button>
          )}
        </div>
      )}
      {!detail && (
        <footer className="visit-footer">
          <span>{trip.title}</span>
          <button onClick={onOpen}>
            <Icon name={visit.actual_location ? 'locate' : 'pin'} size={13} />
            {visit.actual_location ? 'Visit recorded' : 'No visit coordinates'}
          </button>
        </footer>
      )}
      {detail && (
        <>
          <p className="detail-date">
            {formatVisitDate(visit.visited_at, visit.utc_offset_minutes)} · {trip.title}
          </p>
          <div className="location-pair">
            <div>
              <Icon name="locate" size={20} />
              <span>
                <small>ACTUAL VISIT</small>
                {visit.actual_location
                  ? formatCoordinates(visit.actual_location)
                  : 'Location not recorded'}
                {visit.actual_location && (
                  <em>
                    {visit.actual_location.source === 'device'
                      ? `Device GPS${visit.actual_location.accuracy_m !== null ? ` · ±${Math.round(visit.actual_location.accuracy_m)} m` : ''}`
                      : 'Entered manually'}
                  </em>
                )}
              </span>
            </div>
            <div>
              <Icon name="pin" size={20} />
              <span>
                <small>NAMED PLACE</small>
                {place.name}
                <em>
                  {place.position ? formatCoordinates(place.position) : 'No reference coordinates'}
                </em>
              </span>
            </div>
          </div>
        </>
      )}
    </article>
  );
}
