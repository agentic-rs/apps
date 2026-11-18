import type { EventDraft } from '../lib/photo-event-draft';
import { text_limits } from '../lib/model';
import type { TravelPlatform } from '../lib/types';
import { Photo } from './Photo';
import { VisitTimeFields, CoordinateInputs } from './VisitFields';

export function EventReviewCard({
  draft,
  number,
  platform,
  onChange,
  onSuggest,
}: {
  draft: EventDraft;
  number: number;
  platform: TravelPlatform;
  onChange(change: Partial<EventDraft>): void;
  onSuggest(): void;
}) {
  return (
    <article className="form-section" aria-label={`Event ${number}`}>
      <header className="event-review-header">
        <h3>Event {number}</h3>
        <label className="checkbox-label">
          <input
            type="checkbox"
            aria-label={`Include event ${number}`}
            checked={draft.included}
            onChange={(e) => onChange({ included: e.target.checked })}
          />
          Include
        </label>
      </header>
      <div className="event-photos" aria-label="Photos in this event">
        {draft.group.photos.map((photo, photo_index) => (
          <Photo
            key={photo.id}
            photo={photo}
            platform={platform}
            alt={`Event ${number}, photo ${photo_index + 1}`}
          />
        ))}
      </div>
      {draft.included && (
        <>
          <label>
            Event title
            <input
              required
              maxLength={text_limits.check_in_title}
              value={draft.title}
              onChange={(e) => onChange({ title: e.target.value, title_error: '' })}
            />
          </label>
          {draft.title_error && (
            <p className="form-error" role="alert">
              {draft.title_error}
            </p>
          )}
          <VisitTimeFields
            prefix="Event"
            local_time={draft.local_time}
            offset={draft.offset}
            offset_help={
              draft.group.utc_offset_minutes === null
                ? 'Choose the local offset. This photo has no recorded time zone.'
                : 'The local offset during this event.'
            }
            onTime={(local_time) => onChange({ local_time })}
            onOffset={(offset) => onChange({ offset })}
          />
          <CoordinateInputs
            prefix="Event"
            latitude={draft.latitude}
            longitude={draft.longitude}
            onLatitude={(latitude) => onChange({ latitude })}
            onLongitude={(longitude) => onChange({ longitude })}
          />
          {!draft.group.local_time && (
            <p className="field-help">
              This photo has no capture time. Enter when the event happened.
            </p>
          )}
          {!draft.group.location && (
            <p className="field-help">
              No photo GPS was found. You can leave the coordinates empty.
            </p>
          )}
          {platform.native && (
            <button
              type="button"
              className="secondary"
              disabled={!draft.local_time && !draft.latitude && !draft.longitude}
              onClick={onSuggest}
            >
              Suggest title
            </button>
          )}
        </>
      )}
    </article>
  );
}
