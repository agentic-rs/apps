import { useState } from 'react';
import { createId } from '../lib/identity';
import { readCoordinates, text_limits } from '../lib/model';
import type { StopLookup, StopSearchResult } from '../lib/stop-lookup';
import {
  stop_kind_labels,
  stop_kinds,
  type PlannedStop,
  type StopKind,
  type Trip,
} from '../lib/types';
import { CoordinateInputs } from './VisitFields';
import { Dialog, DiscardPrompt } from './Dialog';
import { EditorForm } from './EditorForm';
import { Icon } from './Icon';
import { StopPlacePicker } from './StopPlacePicker';

interface StopFormProps {
  trip: Trip;
  day: string;
  stop?: PlannedStop;
  lookup: StopLookup;
  onSave(stop: PlannedStop): Promise<void>;
  onCancel(): void;
  onDelete?(stop: PlannedStop): void;
}

export function StopForm({ trip, day, stop, lookup, onSave, onCancel, onDelete }: StopFormProps) {
  const [picking, setPicking] = useState<'initial' | 'change' | null>(stop ? null : 'initial');
  const [directory_ref, setDirectoryRef] = useState(stop?.directory_ref);
  const [title, setTitle] = useState(stop?.title ?? '');
  const [stop_day, setDay] = useState(stop?.day ?? day);
  const [kind, setKind] = useState<StopKind>(stop?.kind ?? 'sight');
  const [time, setTime] = useState(stop?.time ?? '');
  const [notes, setNotes] = useState(stop?.notes ?? '');
  const [latitude, setLatitude] = useState(stop?.position?.latitude.toString() ?? '');
  const [longitude, setLongitude] = useState(stop?.position?.longitude.toString() ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [discard, setDiscard] = useState(false);
  const dirty =
    title !== (stop?.title ?? '') ||
    stop_day !== (stop?.day ?? day) ||
    kind !== (stop?.kind ?? 'sight') ||
    time !== (stop?.time ?? '') ||
    notes !== (stop?.notes ?? '') ||
    latitude !== (stop?.position?.latitude.toString() ?? '') ||
    longitude !== (stop?.position?.longitude.toString() ?? '');

  function choosePlace(place: StopSearchResult) {
    setTitle(place.title);
    setKind(place.kind);
    setLatitude(String(place.position.latitude));
    setLongitude(String(place.position.longitude));
    setDirectoryRef({ provider: place.source, id: place.id });
    setPicking(null);
    setError('');
  }

  function enterManually(name: string, suggested_kind: StopKind) {
    setTitle(name);
    setKind(suggested_kind);
    setLatitude('');
    setLongitude('');
    setDirectoryRef(undefined);
    setPicking(null);
    setError('');
  }

  function dismiss() {
    if (busy) return;
    if (dirty) setDiscard(true);
    else onCancel();
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError('');
    setDiscard(false);
    try {
      await onSave({
        id: stop?.id ?? createId(),
        trip_id: trip.id,
        day: stop_day,
        title: title.trim(),
        kind,
        time,
        notes: notes.trim(),
        position: readCoordinates(latitude, longitude),
        ...(directory_ref && { directory_ref }),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save this stop.');
    } finally {
      setBusy(false);
    }
  }

  if (picking) {
    return (
      <Dialog
        title="Add stop"
        full_screen
        onDismiss={() => (picking === 'change' ? setPicking(null) : onCancel())}
      >
        <StopPlacePicker
          trip={trip}
          day={stop_day}
          lookup={lookup}
          onPick={choosePlace}
          onManual={enterManually}
        />
      </Dialog>
    );
  }

  return (
    <Dialog
      title={stop ? 'Edit stop' : 'Add stop'}
      full_screen
      dismiss_disabled={busy}
      onDismiss={dismiss}
    >
      <EditorForm onSave={submit}>
        {(save) => (
          <>
            <fieldset className="form-body stop-form" disabled={busy}>
              <div className="stop-form-heading">
                <p className="stop-form-trip">
                  <Icon name="book" size={17} />
                  {trip.title}
                </p>
                {!stop && (
                  <button
                    className="stop-form-lookup"
                    type="button"
                    onClick={() => setPicking('change')}
                  >
                    <Icon name="search" size={16} />{' '}
                    {directory_ref ? 'Change place' : 'Find a place'}
                  </button>
                )}
              </div>
              <label>
                Stop name
                <input
                  required
                  autoFocus={!directory_ref}
                  maxLength={text_limits.stop_title}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label>
                Category
                <select value={kind} onChange={(e) => setKind(e.target.value as StopKind)}>
                  {stop_kinds.map((value) => (
                    <option key={value} value={value}>
                      {stop_kind_labels[value]}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-grid">
                <label>
                  Day
                  <input
                    type="date"
                    required
                    value={stop_day}
                    onChange={(e) => setDay(e.target.value)}
                  />
                </label>
                <label>
                  <span>
                    Time <span className="optional">(optional)</span>
                  </span>
                  <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                </label>
              </div>
              <label>
                <span>
                  Notes <span className="optional">(optional)</span>
                </span>
                <textarea
                  rows={3}
                  maxLength={text_limits.stop_notes}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
              <details className="stop-coordinates" open={Boolean(stop?.position) || undefined}>
                <summary>
                  Map coordinates <span className="optional">(optional)</span>
                </summary>
                <CoordinateInputs
                  prefix="Stop"
                  latitude={latitude}
                  longitude={longitude}
                  onLatitude={setLatitude}
                  onLongitude={setLongitude}
                />
              </details>
              {stop && onDelete && (
                <button type="button" className="stop-delete" onClick={() => onDelete(stop)}>
                  <Icon name="trash" size={17} /> Delete stop
                </button>
              )}
            </fieldset>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {discard && (
              <DiscardPrompt
                disabled={busy}
                onKeep={() => setDiscard(false)}
                onDiscard={onCancel}
              />
            )}
            <footer className="dialog-footer">
              <button type="button" className="secondary" disabled={busy} onClick={dismiss}>
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy || !title.trim() || !stop_day}
                onClick={save}
              >
                {busy ? 'Saving…' : 'Save stop'}
              </button>
            </footer>
          </>
        )}
      </EditorForm>
    </Dialog>
  );
}
