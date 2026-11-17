import { useRef, useState } from 'react';
import type {
  CheckIn,
  Coordinates,
  PhotoAsset,
  Place,
  TravelPlatform,
  Trip,
  VisitLocation,
} from '../lib/types';
import { currentOffsetMinutes, fromVisitInput, toVisitInput } from '../lib/dates';
import { text_limits } from '../lib/model';
import { createId } from '../lib/identity';
import { Dialog, DiscardPrompt } from './Dialog';
import { Icon } from './Icon';
import { Photo } from './Photo';
import { EditorForm } from './EditorForm';

function readCoordinates(latitude: string, longitude: string): Coordinates | null {
  if (!latitude.trim() && !longitude.trim()) return null;
  if (!latitude.trim() || !longitude.trim())
    throw new Error('Enter both latitude and longitude, or leave both blank.');
  const result = { latitude: Number(latitude), longitude: Number(longitude) };
  if (
    !Number.isFinite(result.latitude) ||
    Math.abs(result.latitude) > 90 ||
    !Number.isFinite(result.longitude) ||
    Math.abs(result.longitude) > 180
  )
    throw new Error('Latitude must be between −90 and 90; longitude between −180 and 180.');
  return result;
}

export function CheckInForm({
  trip,
  places,
  check_in,
  platform,
  onSave,
  onCancel,
}: {
  trip: Trip;
  places: Place[];
  check_in?: CheckIn;
  platform: TravelPlatform;
  onSave(visit: CheckIn, place: Place, unused: PhotoAsset[]): Promise<void>;
  onCancel(unused: PhotoAsset[]): Promise<void>;
}) {
  const original_place = places.find((place) => place.id === check_in?.place_id);
  const [place_id, setPlaceId] = useState(original_place?.id ?? '');
  const [name, setName] = useState(original_place?.name ?? '');
  const [locality, setLocality] = useState(original_place?.locality ?? '');
  const [place_latitude, setPlaceLatitude] = useState(
    original_place?.position?.latitude.toString() ?? '',
  );
  const [place_longitude, setPlaceLongitude] = useState(
    original_place?.position?.longitude.toString() ?? '',
  );
  const [edit_place, setEditPlace] = useState(false);
  const [offset, setOffset] = useState(
    (check_in?.utc_offset_minutes ?? currentOffsetMinutes()).toString(),
  );
  const [visited, setVisited] = useState(
    toVisitInput(
      check_in?.visited_at ?? new Date().toISOString(),
      check_in?.utc_offset_minutes ?? currentOffsetMinutes(),
    ),
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
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const selected_place = places.find((place) => place.id === place_id);
  const offsets = [
    ...new Set([...Array.from({ length: 113 }, (_, index) => index * 15 - 840), Number(offset)]),
  ].sort((a, b) => a - b);

  function choosePlace(id: string) {
    const place = places.find((row) => row.id === id);
    setPlaceId(id);
    setName(place?.name ?? '');
    setLocality(place?.locality ?? '');
    setPlaceLatitude(place?.position?.latitude.toString() ?? '');
    setPlaceLongitude(place?.position?.longitude.toString() ?? '');
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
      if (photos.length + inputs.length > 20)
        throw new Error('A check-in can hold up to 20 photos.');
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
    if (busy) return;
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
      const place: Place =
        selected_place && !edit_place
          ? selected_place
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
        place_id: place.id,
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
    <Dialog title={check_in ? 'Edit check-in' : 'Keep this moment'} onDismiss={dismiss} full_screen>
      <EditorForm onSave={submit} onChange={() => setDirty(true)}>
        {(save) => (
          <>
            <fieldset disabled={busy} className="form-body check-in-form">
              <p className="muted">
                In <strong>{trip.title}</strong> <span className="dot">·</span> 打卡
              </p>
              <section className="form-section">
                <div className="section-heading">
                  <span className="step">01</span>
                  <h3>The named place</h3>
                </div>
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
                    <div className="form-grid">
                      <label>
                        Place name
                        <input
                          autoFocus={!check_in}
                          required
                          maxLength={text_limits.place_name}
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="West Lake / 西湖"
                        />
                      </label>
                      <label>
                        City or area <span className="optional">optional</span>
                        <input
                          maxLength={text_limits.place_locality}
                          value={locality}
                          onChange={(e) => setLocality(e.target.value)}
                          placeholder="Hangzhou"
                        />
                      </label>
                    </div>
                    <details>
                      <summary>
                        Place reference coordinates <span className="optional">optional</span>
                      </summary>
                      <p className="field-help">
                        The place’s standard position, separate from where your visit happened. Use
                        WGS84 coordinates.
                      </p>
                      <CoordinateInputs
                        prefix="Place"
                        latitude={place_latitude}
                        longitude={place_longitude}
                        onLatitude={setPlaceLatitude}
                        onLongitude={setPlaceLongitude}
                      />
                    </details>
                  </>
                )}
              </section>
              <section className="form-section">
                <div className="section-heading">
                  <span className="step">02</span>
                  <h3>Where & when it happened</h3>
                </div>
                <p className="field-help">Your actual visit position. Leave it blank if unknown.</p>
                <button
                  type="button"
                  className="secondary locate-button"
                  onClick={() => void locate()}
                >
                  <Icon name="locate" />
                  Use current location
                </button>
                <p className="field-help">
                  This records where you are now. For an earlier visit, enter its coordinates.
                </p>
                <CoordinateInputs
                  prefix="Visit"
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
                {fix?.source === 'device' && (
                  <p className="location-status">
                    <Icon name="check" size={14} />
                    Device location
                    {fix.accuracy_m !== null ? ` · ±${Math.round(fix.accuracy_m)} m` : ''}
                  </p>
                )}
                <div className="form-grid time-fields">
                  <label>
                    Visit date & time
                    <input
                      required
                      type="datetime-local"
                      value={visited}
                      onChange={(e) => setVisited(e.target.value)}
                    />
                  </label>
                  <label>
                    Visit time zone
                    <select value={offset} onChange={(e) => setOffset(e.target.value)}>
                      {offsets.map((value) => (
                        <option key={value} value={value}>
                          UTC{value >= 0 ? '+' : '−'}
                          {String(Math.floor(Math.abs(value) / 60)).padStart(2, '0')}:
                          {String(Math.abs(value) % 60).padStart(2, '0')}
                        </option>
                      ))}
                    </select>
                    <span className="field-help">The local time zone during your visit.</span>
                  </label>
                </div>
              </section>
              <section className="form-section">
                <div className="section-heading">
                  <span className="step">03</span>
                  <h3>A few things to remember</h3>
                </div>
                <label>
                  Notes <span className="optional">optional</span>
                  <textarea
                    rows={3}
                    maxLength={text_limits.check_in_notes}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="What made this place worth stopping for?"
                  />
                </label>
                <div className="photo-tools">
                  <span>
                    Photos <span className="optional">{photos.length}/20 · up to 32 MiB each</span>
                  </span>
                  <div className="button-row">
                    <button
                      type="button"
                      className="secondary"
                      disabled={photos.length >= 20}
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
                      disabled={photos.length >= 20}
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
                  accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,image/avif"
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
                  <div className="draft-photos">
                    {photos.map((photo, index) => (
                      <div key={photo.id}>
                        <Photo
                          photo={photo}
                          platform={platform}
                          alt={`Attached photo ${index + 1}`}
                        />
                        <button
                          type="button"
                          className="remove-photo"
                          aria-label={`Remove photo ${index + 1}`}
                          onClick={() => {
                            setPhotos((previous) =>
                              previous.filter((item) => item.id !== photo.id),
                            );
                            setDirty(true);
                          }}
                        >
                          <Icon name="close" size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </fieldset>
            {error && (
              <p role="alert" className="form-error">
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
            <footer className="dialog-footer">
              <button type="button" className="secondary" disabled={busy} onClick={dismiss}>
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                onClick={save}
                disabled={busy || ((!selected_place || edit_place) && !name.trim())}
              >
                {busy ? 'Working…' : 'Save check-in'}
                <Icon name="check" size={17} />
              </button>
            </footer>
          </>
        )}
      </EditorForm>
    </Dialog>
  );
}

function CoordinateInputs({
  prefix,
  latitude,
  longitude,
  onLatitude,
  onLongitude,
}: {
  prefix: string;
  latitude: string;
  longitude: string;
  onLatitude(value: string): void;
  onLongitude(value: string): void;
}) {
  return (
    <div className="form-grid">
      <label>
        {prefix} latitude
        <input
          type="number"
          step="any"
          min={-90}
          max={90}
          value={latitude}
          onChange={(e) => onLatitude(e.target.value)}
          placeholder="—"
        />
      </label>
      <label>
        {prefix} longitude
        <input
          type="number"
          step="any"
          min={-180}
          max={180}
          value={longitude}
          onChange={(e) => onLongitude(e.target.value)}
          placeholder="—"
        />
      </label>
    </div>
  );
}
