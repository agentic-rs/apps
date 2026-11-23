import { useLayoutEffect, useRef, useState } from 'react';
import { daysBetween, isCalendarDate, offsetDay } from '../lib/dates';
import { createId } from '../lib/identity';
import { readCoordinates, text_limits } from '../lib/model';
import type { StopLookup, StopSearchCategory, StopSearchResult } from '../lib/stop-lookup';
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
  trip_stops: PlannedStop[];
  day: string;
  initial_category?: StopSearchCategory;
  stop?: PlannedStop;
  lookup: StopLookup;
  onSave(stop: PlannedStop): Promise<void>;
  onCancel(): void;
  onDelete?(stop: PlannedStop): void;
}

function checkoutAfter(day: string, nights: number) {
  if (!isCalendarDate(day) || day === '9999-12-31') return '';
  return offsetDay(day, Math.min(nights, daysBetween(day, '9999-12-31')));
}

export function StopForm({
  trip,
  trip_stops,
  day,
  stop,
  initial_category,
  lookup,
  onSave,
  onCancel,
  onDelete,
}: StopFormProps) {
  const [picking, setPicking] = useState<'initial' | 'change' | null>(stop ? null : 'initial');
  const [picker_day, setPickerDay] = useState(day);
  const [directory_ref, setDirectoryRef] = useState(stop?.directory_ref);
  const [title, setTitle] = useState(stop?.title ?? '');
  const [stop_day, setDay] = useState(stop?.day ?? day);
  const [checkout, setCheckout] = useState(stop?.checkout_date ?? '');
  const [kind, setKind] = useState<StopKind>(stop?.kind ?? 'sight');
  const [time, setTime] = useState(stop?.time ?? '');
  const [notes, setNotes] = useState(stop?.notes ?? '');
  const [latitude, setLatitude] = useState(stop?.position?.latitude.toString() ?? '');
  const [longitude, setLongitude] = useState(stop?.position?.longitude.toString() ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [discard, setDiscard] = useState(false);
  const last_pick = useRef<HTMLElement | null>(null);
  const change_place = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (picking === 'change' && last_pick.current?.isConnected) {
      last_pick.current.focus({ preventScroll: true });
    } else if (!picking && directory_ref && !stop) {
      change_place.current?.focus({ preventScroll: true });
    }
  }, [picking, directory_ref, stop]);
  const dirty =
    title !== (stop?.title ?? '') ||
    stop_day !== (stop?.day ?? day) ||
    kind !== (stop?.kind ?? 'sight') ||
    (kind === 'stay' && checkout !== (stop?.checkout_date ?? '')) ||
    time !== (stop?.time ?? '') ||
    notes !== (stop?.notes ?? '') ||
    latitude !== (stop?.position?.latitude.toString() ?? '') ||
    longitude !== (stop?.position?.longitude.toString() ?? '');

  function chooseKind(value: StopKind) {
    if (value === 'stay' && kind !== 'stay') setCheckout(checkoutAfter(stop_day, 1));
    setKind(value);
  }

  function changeDay(value: string) {
    if (kind === 'stay' && isCalendarDate(value) && isCalendarDate(checkout)) {
      const nights = isCalendarDate(stop_day) ? Math.max(1, daysBetween(stop_day, checkout)) : 1;
      setCheckout(checkoutAfter(value, nights));
    }
    setDay(value);
  }

  function choosePlace(place: StopSearchResult) {
    last_pick.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTitle(place.title);
    chooseKind(place.kind);
    setLatitude(String(place.position.latitude));
    setLongitude(String(place.position.longitude));
    setDirectoryRef({
      provider: place.source,
      id: place.id,
      ...(place.subtitle && { subtitle: place.subtitle.slice(0, text_limits.place_locality) }),
    });
    setPicking(null);
    setError('');
  }

  function enterManually(name: string, suggested_kind: StopKind) {
    last_pick.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTitle(name);
    chooseKind(suggested_kind);
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
        ...(kind === 'stay' && checkout && { checkout_date: checkout }),
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

  return (
    <Dialog
      title={stop ? 'Edit stop' : !picking && kind === 'stay' ? 'Hotel stay' : 'Add stop'}
      full_screen
      dismiss_disabled={busy}
      onDismiss={picking === 'change' ? () => setPicking(null) : picking ? onCancel : dismiss}
    >
      {!stop && (
        <div className="stop-picker-pane" hidden={!picking}>
          <StopPlacePicker
            key={picker_day}
            trip={trip}
            day={picker_day}
            initial_category={initial_category}
            day_stops={trip_stops.filter((item) => item.day === picker_day)}
            lookup={lookup}
            onPick={choosePlace}
            onManual={enterManually}
          />
        </div>
      )}
      {!picking && (
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
                      ref={change_place}
                      className="stop-form-lookup"
                      type="button"
                      onClick={() => {
                        setPickerDay(stop_day);
                        setPicking('change');
                      }}
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
                {directory_ref?.subtitle && (
                  <p className="stop-place-address">
                    <Icon name="pin" size={15} /> {directory_ref.subtitle}
                  </p>
                )}
                <label>
                  Category
                  <select value={kind} onChange={(e) => chooseKind(e.target.value as StopKind)}>
                    {stop_kinds.map((value) => (
                      <option key={value} value={value}>
                        {stop_kind_labels[value]}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="form-grid">
                  <label>
                    {kind === 'stay' ? 'Check-in date' : 'Day'}
                    <input
                      type="date"
                      required
                      value={stop_day}
                      onChange={(e) => changeDay(e.target.value)}
                    />
                  </label>
                  {kind === 'stay' && (
                    <label>
                      Check-out date
                      <input
                        type="date"
                        min={checkoutAfter(stop_day, 1) || undefined}
                        value={checkout}
                        onChange={(e) => setCheckout(e.target.value)}
                      />
                    </label>
                  )}
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
      )}
    </Dialog>
  );
}
