import { useEffect, useRef, useState } from 'react';
import type {
  CheckIn,
  PhotoAsset,
  Place,
  PlannedStop,
  TravelPlatform,
  Trip,
  VisitLocation,
} from '../lib/types';
import { currentOffsetMinutes, fromVisitInput, isCalendarDate, toVisitInput } from '../lib/dates';
import {
  readCoordinates,
  max_photos_per_check_in,
  supported_image_types,
  text_limits,
} from '../lib/model';
import { createId } from '../lib/identity';
import { usePlannedCheckInPlace } from '../lib/check-in-place';
import { Dialog, DiscardPrompt } from './Dialog';
import { Icon } from './Icon';
import { DraftPhotos } from './DraftPhotos';
import { EditorForm } from './EditorForm';
import { CoordinateInputs, VisitTimeFields } from './VisitFields';
import '../check-in.css';

const short_day = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

function placeFields(place: Pick<Place, 'name' | 'locality' | 'position'>) {
  return {
    name: place.name,
    locality: place.locality,
    place_latitude: place.position?.latitude.toString() ?? '',
    place_longitude: place.position?.longitude.toString() ?? '',
  };
}

export function CheckInForm({
  trip,
  places,
  check_in,
  day,
  stop,
  stops,
  platform,
  onSave,
  onCancel,
}: {
  trip: Trip;
  places: Place[];
  check_in?: CheckIn;
  day: string;
  stop?: PlannedStop;
  stops: PlannedStop[];
  platform: TravelPlatform;
  onSave(visit: CheckIn, place: Place | null, unused: PhotoAsset[]): Promise<void>;
  onCancel(unused: PhotoAsset[]): Promise<void>;
}) {
  const editing_event = Boolean(check_in?.title);
  const [stop_id, setStopId] = useState(check_in?.stop_id ?? stop?.id ?? '');
  const [title, setTitle] = useState(check_in?.title ?? '');
  const [place_id, setPlaceId] = useState(check_in?.place_id ?? '');
  const [place_draft, setPlaceDraft] = useState<ReturnType<typeof placeFields> | null>(null);
  const [place_expanded, setPlaceExpanded] = useState(!stop && !check_in);
  const [edit_place, setEditPlace] = useState(false);
  const [visited, setVisited] = useState(() => {
    if (check_in) return toVisitInput(check_in.visited_at, check_in.utc_offset_minutes);
    const now = new Date();
    return day + 'T' + toVisitInput(now.toISOString(), currentOffsetMinutes(now)).slice(11);
  });
  const [offset, setOffset] = useState(() =>
    String(check_in?.utc_offset_minutes ?? currentOffsetMinutes(new Date(visited))),
  );
  const [notes, setNotes] = useState(check_in?.notes ?? '');
  const [latitude, setLatitude] = useState(check_in?.actual_location?.latitude.toString() ?? '');
  const [longitude, setLongitude] = useState(check_in?.actual_location?.longitude.toString() ?? '');
  const [fix, setFix] = useState<VisitLocation | null>(check_in?.actual_location ?? null);
  const [photos, setPhotos] = useState<PhotoAsset[]>(check_in?.photos ?? []);
  const imported = useRef<PhotoAsset[]>([]);
  const upload = useRef<HTMLInputElement>(null);
  const camera_input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const error_message = useRef<HTMLParagraphElement>(null);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const selected_place = places.find((place) => place.id === place_id);
  const selected_stop = stops.find((item) => item.id === stop_id);
  const { place: planned_place, loading: resolving_place } = usePlannedCheckInPlace(
    trip,
    check_in || selected_place || place_draft ? undefined : selected_stop,
  );
  const proposed = placeFields(selected_place ?? planned_place);
  // Once the traveler edits a named place, changing its itinerary link preserves the whole place.
  const fields = selected_place && !edit_place ? proposed : (place_draft ?? proposed);
  const { name, locality, place_latitude, place_longitude } = fields;
  const visit_day = visited.slice(0, 10);

  useEffect(() => {
    if (error) error_message.current?.focus();
  }, [error]);

  function choosePlace(id: string) {
    setPlaceId(id);
    setPlaceDraft(null);
    setEditPlace(false);
  }
  async function cancel() {
    if (busy) return;
    setBusy(true);
    try {
      await onCancel(imported.current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not close this draft.');
      setBusy(false);
    }
  }
  function dismiss() {
    if (!busy) {
      if (dirty) setDiscard(true);
      else void cancel();
    }
  }
  async function importPhotos(files?: FileList, camera = false) {
    if (busy) return;
    setDiscard(false);
    setBusy(true);
    setError('');
    try {
      const inputs: (File | undefined)[] = files ? Array.from(files) : [undefined];
      if (photos.length + inputs.length > max_photos_per_check_in)
        throw new Error(`An entry can hold up to ${max_photos_per_check_in} photos.`);
      for (const file of inputs) {
        const asset = camera ? await platform.capturePhoto() : await platform.importPhoto(file);
        if (asset) {
          imported.current.push(asset);
          setPhotos((previous) => [...previous, asset]);
          setDirty(true);
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not add this photo.');
    } finally {
      setBusy(false);
      if (upload.current) upload.current.value = '';
      if (camera_input.current) camera_input.current.value = '';
    }
  }
  async function locate() {
    if (busy) return;
    setDiscard(false);
    setBusy(true);
    setError('');
    try {
      const position = await platform.currentLocation();
      if (position) {
        setLatitude(String(position.latitude));
        setLongitude(String(position.longitude));
        setFix(position);
        setDirty(true);
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Location is unavailable. Enter coordinates manually or save without them.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (busy || resolving_place) return;
    setDiscard(false);
    setBusy(true);
    setError('');
    try {
      const now = new Date().toISOString();
      const coordinates = readCoordinates(latitude, longitude);
      const actual_location: VisitLocation | null = coordinates
        ? {
            ...coordinates,
            source: fix?.source ?? 'manual',
            accuracy_m: fix?.accuracy_m ?? null,
            captured_at: fix?.captured_at ?? null,
          }
        : null;
      const place: Place | null =
        selected_place && !edit_place
          ? selected_place
          : editing_event && !name.trim() && !selected_place
            ? null
            : {
                id: selected_place?.id ?? createId(),
                name: name.trim(),
                locality: locality.trim(),
                position: readCoordinates(place_latitude, place_longitude),
                created_at: selected_place?.created_at ?? now,
                updated_at: now,
              };
      const visit: CheckIn = {
        id: check_in?.id ?? createId(),
        trip_id: trip.id,
        ...(stop_id && { stop_id }),
        place_id: place?.id ?? null,
        ...(editing_event && { title: title.trim() }),
        visited_at:
          check_in &&
          Number(offset) === check_in.utc_offset_minutes &&
          visited === toVisitInput(check_in.visited_at, check_in.utc_offset_minutes)
            ? check_in.visited_at
            : fromVisitInput(visited, Number(offset)),
        utc_offset_minutes: Number(offset),
        actual_location,
        notes: notes.trim(),
        photos,
        created_at: check_in?.created_at ?? now,
        updated_at: now,
      };
      const retained = new Set(photos.map((photo) => photo.id));
      const unused = [...(check_in?.photos ?? []), ...imported.current].filter(
        (photo) => !retained.has(photo.id),
      );
      await onSave(visit, place, unused);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Could not save this check-in. Your draft is still here.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={editing_event ? 'Edit event' : check_in ? 'Edit check-in' : 'New check-in'}
      onDismiss={dismiss}
      full_screen
    >
      <EditorForm onSave={submit} onChange={() => setDirty(true)}>
        {(save) => (
          <>
            <fieldset
              disabled={busy || discard}
              className="form-body check-in-form"
              onInvalidCapture={(event) => {
                const field = event.target as HTMLElement;
                if (
                  field !==
                  event.currentTarget.querySelector(
                    'input:invalid, select:invalid, textarea:invalid',
                  )
                )
                  return;
                let details = field.closest('details');
                while (details) {
                  details.open = true;
                  details = details.parentElement?.closest('details') ?? null;
                }
                // WebKit cannot focus an invalid control until its disclosure has laid out.
                requestAnimationFrame(() => {
                  if (!field.isConnected) return;
                  field.focus({ preventScroll: true });
                  field.scrollIntoView({ block: 'nearest' });
                });
              }}
            >
              <header className="check-in-context">
                <span>
                  <Icon name="book" size={16} /> {trip.title}
                </span>
                {isCalendarDate(visit_day) && (
                  <time dateTime={visit_day}>
                    {short_day.format(new Date(visit_day + 'T00:00:00Z'))}
                  </time>
                )}
              </header>
              {editing_event && (
                <label>
                  Event title
                  <input
                    required
                    maxLength={text_limits.check_in_title}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
              )}
              <details
                className="check-in-place"
                open={place_expanded}
                onToggle={(event) => setPlaceExpanded(event.currentTarget.open)}
              >
                <summary
                  className="check-in-place-summary"
                  aria-label="Place details"
                  aria-description={[name, locality].filter(Boolean).join(', ')}
                >
                  <span className="check-in-pin">
                    <Icon name="pin" size={21} />
                  </span>
                  <span className="check-in-place-heading">
                    <strong>
                      {name.trim() || (editing_event ? 'Add a place' : 'Place details')}
                    </strong>
                    {resolving_place ? (
                      <small role="status">Finding city…</small>
                    ) : (
                      locality.trim() && <small>{locality}</small>
                    )}
                  </span>
                  <Icon name="next" size={16} />
                </summary>
                <div className="check-in-place-fields">
                  {stops.length > 0 && (
                    <label>
                      Planned stop
                      <select value={stop_id} onChange={(event) => setStopId(event.target.value)}>
                        <option value="">Unplanned visit</option>
                        {stops.map((item) => (
                          <option key={item.id} value={item.id}>
                            {short_day.format(new Date(item.day + 'T00:00:00Z'))} · {item.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {places.length > 0 && (
                    <label>
                      Choose a saved place
                      <select value={place_id} onChange={(e) => choosePlace(e.target.value)}>
                        <option value="">+ Add a new place</option>
                        {places.map((place) => (
                          <option key={place.id} value={place.id}>
                            {place.name}
                            {place.locality ? ` · ${place.locality}` : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {selected_place && (
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={edit_place}
                        onChange={(e) => setEditPlace(e.target.checked)}
                      />
                      Edit this place for all its visits
                    </label>
                  )}
                  {(!selected_place || edit_place) && (
                    <>
                      <div className="check-in-name-fields">
                        <label>
                          Place name
                          <input
                            required={
                              !editing_event ||
                              !!selected_place ||
                              !!locality.trim() ||
                              !!place_latitude ||
                              !!place_longitude
                            }
                            maxLength={text_limits.place_name}
                            value={name}
                            onChange={(e) => setPlaceDraft({ ...fields, name: e.target.value })}
                          />
                        </label>
                        <label>
                          City or area
                          <input
                            maxLength={text_limits.place_locality}
                            value={locality}
                            onChange={(e) => setPlaceDraft({ ...fields, locality: e.target.value })}
                            placeholder="Optional"
                          />
                        </label>
                      </div>
                      <details>
                        <summary>Place reference coordinates</summary>
                        <p className="field-help">This pin marks the named place on the map.</p>
                        <CoordinateInputs
                          prefix="Place"
                          require_pair
                          latitude={place_latitude}
                          longitude={place_longitude}
                          onLatitude={(value) =>
                            setPlaceDraft({ ...fields, place_latitude: value })
                          }
                          onLongitude={(value) =>
                            setPlaceDraft({ ...fields, place_longitude: value })
                          }
                        />
                      </details>
                    </>
                  )}
                </div>
              </details>
              <section className="check-in-journal" aria-label="Notes and photos">
                <label>
                  Notes
                  <textarea
                    rows={2}
                    maxLength={text_limits.check_in_notes}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Add a note"
                  />
                </label>
                <div className="photo-tools">
                  <span>
                    Photos{' '}
                    <span className="optional">
                      {photos.length}/{max_photos_per_check_in} · up to 32 MiB each
                    </span>
                  </span>
                  <div className="button-row">
                    <button
                      type="button"
                      className="secondary"
                      disabled={photos.length >= max_photos_per_check_in}
                      onClick={() =>
                        platform.native ? void importPhotos() : upload.current?.click()
                      }
                    >
                      <Icon name="photo" size={17} />
                      Add photos
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      disabled={photos.length >= max_photos_per_check_in}
                      aria-label="Take a photo"
                      onClick={() =>
                        platform.native
                          ? void importPhotos(undefined, true)
                          : camera_input.current?.click()
                      }
                    >
                      <Icon name="camera" />
                    </button>
                  </div>
                </div>
                <input
                  ref={upload}
                  className="hidden-input"
                  type="file"
                  accept={supported_image_types.join(',')}
                  multiple
                  onChange={(e) => {
                    if (e.target.files?.length) void importPhotos(e.target.files);
                  }}
                />
                <input
                  ref={camera_input}
                  className="hidden-input"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => {
                    if (e.target.files?.length) void importPhotos(e.target.files);
                  }}
                />
                {photos.length > 0 && (
                  <DraftPhotos
                    photos={photos}
                    platform={platform}
                    onRemove={(id) => {
                      setPhotos((previous) => previous.filter((item) => item.id !== id));
                      setDirty(true);
                    }}
                  />
                )}
              </section>
              <section className="check-in-visit" aria-labelledby="check-in-visit-heading">
                <h3 id="check-in-visit-heading">Visit details</h3>
                <VisitTimeFields
                  prefix="Visit"
                  local_time={visited}
                  offset={offset}
                  offset_help="Local time at the visit."
                  onTime={setVisited}
                  onOffset={setOffset}
                />
                <div className="check-in-position">
                  <button type="button" className="secondary" onClick={() => void locate()}>
                    <Icon name="locate" size={18} />
                    Use current location
                  </button>
                  <p className="location-status" role="status">
                    {fix?.source === 'device'
                      ? `Device location${fix.accuracy_m !== null ? ` · ±${Math.round(fix.accuracy_m)} m` : ''}`
                      : fix?.source === 'photo'
                        ? 'Location from photo'
                        : latitude && longitude
                          ? 'Manually entered location'
                          : latitude || longitude
                            ? 'Incomplete visit location'
                            : 'No visit location'}
                  </p>
                </div>
                <details>
                  <summary>Visit coordinates</summary>
                  <p className="field-help">Enter where you were during this visit.</p>
                  <CoordinateInputs
                    prefix="Visit"
                    require_pair
                    latitude={latitude}
                    longitude={longitude}
                    onLatitude={(value) => {
                      setLatitude(value);
                      setFix(null);
                    }}
                    onLongitude={(value) => {
                      setLongitude(value);
                      setFix(null);
                    }}
                  />
                </details>
              </section>
            </fieldset>
            {error && (
              <p role="alert" className="form-error" tabIndex={-1} ref={error_message}>
                {error}
              </p>
            )}
            {discard && (
              <DiscardPrompt
                disabled={busy}
                onKeep={() => setDiscard(false)}
                onDiscard={() => void cancel()}
              />
            )}
            <footer className="dialog-footer" inert={discard}>
              <button type="button" className="secondary" disabled={busy} onClick={dismiss}>
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                onClick={save}
                disabled={
                  busy ||
                  resolving_place ||
                  (editing_event ? !title.trim() : (!selected_place || edit_place) && !name.trim())
                }
              >
                {busy ? 'Working…' : editing_event ? 'Save event' : 'Save check-in'}
                <Icon name="check" size={17} />
              </button>
            </footer>
          </>
        )}
      </EditorForm>
    </Dialog>
  );
}
