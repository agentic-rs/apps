import { lazy, Suspense, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { citiesOnDay } from '../lib/city-days';
import { daysBetween, isCalendarDate, itineraryDayLabel, offsetDay } from '../lib/dates';
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
import { isContinuingStay } from '../lib/hotel-stays';

const PlaceMapPreview = lazy(() => import('./PlaceMapPreview'));

interface StopFormProps {
  trip: Trip;
  trip_stops: PlannedStop[];
  day: string;
  initial_category?: StopSearchCategory;
  stop?: PlannedStop;
  native: boolean;
  lookup: StopLookup;
  onSave(stop: PlannedStop): Promise<void>;
  onCancel(): void;
  onDelete?(stop: PlannedStop): void;
}

function checkoutAfter(day: string, nights: number) {
  if (!isCalendarDate(day) || day === '9999-12-31') return '';
  return offsetDay(day, Math.min(nights, daysBetween(day, '9999-12-31')));
}

const date_format = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});
const time_format = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
});
const search_categories: Record<StopKind, StopSearchCategory> = {
  sight: 'sight',
  stay: 'stay',
  food: 'food',
  other: 'all',
  transport: 'all',
};
const picker_titles: Record<StopSearchCategory, string> = {
  sight: 'Choose a sight',
  stay: 'Choose a hotel',
  food: 'Choose a food stop',
  airport: 'Choose an airport',
  all: 'Choose a place',
};

function ScheduleField({
  label,
  type,
  value,
  onChange,
  min,
  required,
  detail,
}: {
  label: string;
  type: 'date' | 'time';
  value: string;
  onChange(value: string): void;
  min?: string;
  required?: boolean;
  detail?: string;
}) {
  let formatted = type === 'date' ? 'Set date' : 'Set time';
  if (type === 'date' && isCalendarDate(value))
    formatted = date_format.format(new Date(value + 'T00:00:00Z'));
  if (type === 'time' && value)
    formatted = time_format.format(new Date('2000-01-01T' + value + 'Z'));
  return (
    <label className="stop-setting">
      <span>
        {label}
        {detail && <small>{detail}</small>}
      </span>
      <span className="stop-setting-control">
        <span className="stop-touch-value" aria-hidden="true">
          {formatted}
        </span>
        <input
          aria-label={label}
          type={type}
          value={value}
          min={min}
          required={required}
          onChange={(event) => onChange(event.target.value)}
        />
      </span>
    </label>
  );
}

export function StopForm(props: StopFormProps) {
  const [planned, setPlanned] = useState<PlannedStop | null>(null);
  return (
    <>
      <StopEditor {...props} onEditPlanned={props.stop ? undefined : setPlanned} />
      {planned && (
        <StopEditor
          {...props}
          key={planned.id}
          stop={planned}
          initial_category={undefined}
          onCancel={() => setPlanned(null)}
        />
      )}
    </>
  );
}

function StopEditor({
  trip,
  trip_stops,
  day,
  stop,
  initial_category,
  lookup,
  onSave,
  onCancel,
  onDelete,
  onEditPlanned,
  native,
}: StopFormProps & { onEditPlanned?(stop: PlannedStop): void }) {
  const [picking, setPicking] = useState<'initial' | 'change' | null>(stop ? null : 'initial');
  const [picker_day, setPickerDay] = useState<string | null>(stop ? null : day);
  const [directory_ref, setDirectoryRef] = useState(stop?.directory_ref);
  const [city, setCity] = useState(stop?.city);
  const [city_id, setCityId] = useState(stop?.city_id);
  const [title, setTitle] = useState(stop?.title ?? '');
  const [stop_day, setDay] = useState(stop?.day ?? day);
  const [checkout, setCheckout] = useState(stop?.checkout_date ?? '');
  const [kind, setKind] = useState<StopKind>(stop?.kind ?? 'sight');
  const [picker_category, setPickerCategory] = useState<StopSearchCategory>(
    initial_category ??
      (stop?.directory_ref?.provider === 'ourairports'
        ? 'airport'
        : search_categories[stop?.kind ?? 'sight']),
  );
  const [time, setTime] = useState(stop?.time ?? '');
  const [notes, setNotes] = useState(stop?.notes ?? '');
  const [latitude, setLatitude] = useState(stop?.position?.latitude.toString() ?? '');
  const [longitude, setLongitude] = useState(stop?.position?.longitude.toString() ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [discard, setDiscard] = useState(false);
  const [show_map, setShowMap] = useState(false);
  const position = useMemo(() => {
    try {
      return readCoordinates(latitude, longitude);
    } catch {
      // Incomplete coordinate edits become previewable once both fields are valid.
      return null;
    }
  }, [latitude, longitude]);
  const preview_stops = useMemo(
    () => trip_stops.filter((item) => item.day === stop_day),
    [trip_stops, stop_day],
  );
  const last_pick = useRef<HTMLElement | null>(null);
  const change_place = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (picking && last_pick.current?.isConnected) {
      last_pick.current.focus({ preventScroll: true });
    } else if (!picking && picker_day && (stop || directory_ref)) {
      change_place.current?.focus({ preventScroll: true });
    }
  }, [picking, picker_day, directory_ref, stop]);
  const nights =
    kind === 'stay' && isCalendarDate(stop_day) && isCalendarDate(checkout)
      ? daysBetween(stop_day, checkout)
      : 0;
  const dirty =
    city !== stop?.city ||
    city_id !== stop?.city_id ||
    title !== (stop?.title ?? '') ||
    stop_day !== (stop?.day ?? day) ||
    kind !== (stop?.kind ?? 'sight') ||
    (kind === 'stay' && checkout !== (stop?.checkout_date ?? '')) ||
    time !== (stop?.time ?? '') ||
    notes !== (stop?.notes ?? '') ||
    latitude !== (stop?.position?.latitude.toString() ?? '') ||
    longitude !== (stop?.position?.longitude.toString() ?? '');
  const source_changed =
    directory_ref?.id !== stop?.directory_ref?.id ||
    directory_ref?.provider !== stop?.directory_ref?.provider ||
    directory_ref?.subtitle !== stop?.directory_ref?.subtitle;
  const day_label =
    trip.start_date && isCalendarDate(stop_day) ? itineraryDayLabel(stop_day, day, trip) : '';
  const place_context = [day_label, city || citiesOnDay(trip, stop_day).join(' → ') || trip.title]
    .filter(Boolean)
    .join(' · ');

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

  function choosePlace(place: StopSearchResult, city?: string, city_id?: string) {
    last_pick.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTitle(place.title);
    setCity(city);
    setCityId(city_id);
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

  function enterManually(name: string, suggested_kind: StopKind, city?: string, city_id?: string) {
    last_pick.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (picking !== 'change' || name) setTitle(name);
    setCity(city);
    setCityId(city_id);
    chooseKind(suggested_kind);
    if (picking !== 'change' || (name && name !== title)) {
      setLatitude('');
      setLongitude('');
    }
    setDirectoryRef(undefined);
    setPicking(null);
    setError('');
  }

  function dismiss() {
    if (busy) return;
    if (picking === 'change') {
      setPicking(null);
    } else if (dirty || source_changed) {
      setPicking(null);
      setDiscard(true);
    } else {
      onCancel();
    }
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
        ...(city && { city }),
        ...(city_id && { city_id }),
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
    <>
      <Dialog
        title={
          picking
            ? picker_titles[picker_category]
            : stop
              ? 'Edit stop'
              : !picking && kind === 'stay'
                ? 'Hotel stay'
                : 'Add stop'
        }
        full_screen
        dismiss_disabled={busy}
        onDismiss={dismiss}
        onBack={!stop && !picking && !discard ? () => setPicking('initial') : dismiss}
      >
        {picker_day !== null && (
          <div className="stop-picker-pane" hidden={!picking}>
            <StopPlacePicker
              key={picker_day}
              trip={trip}
              day={picker_day}
              initial_city={city}
              initial_city_id={city_id}
              initial_category={picker_category}
              onCategoryChange={setPickerCategory}
              day_stops={trip_stops.filter(
                (item) =>
                  item.day === picker_day ||
                  (isContinuingStay(item, picker_day) && item.checkout_date !== picker_day),
              )}
              lookup={lookup}
              onPick={choosePlace}
              onManual={enterManually}
              onEditPlanned={
                picking === 'initial' && !dirty && !source_changed ? onEditPlanned : undefined
              }
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
                      {place_context}
                    </p>
                    <button
                      ref={change_place}
                      className="stop-form-lookup"
                      type="button"
                      onClick={() => {
                        const search_day = isCalendarDate(stop_day) ? stop_day : day;
                        if (picker_day !== search_day) {
                          setPickerCategory(
                            directory_ref?.provider === 'ourairports'
                              ? 'airport'
                              : search_categories[kind],
                          );
                        }
                        setPickerDay(search_day);
                        setPicking('change');
                      }}
                    >
                      <Icon name="search" size={16} />{' '}
                      {directory_ref ? 'Change place' : 'Find a place'}
                    </button>
                  </div>
                  <div className="stop-place-fields">
                    <label className="stop-name-field">
                      Stop name
                      <input
                        required
                        autoFocus={!directory_ref && !stop}
                        maxLength={text_limits.stop_title}
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                      />
                    </label>
                    {position ? (
                      <button
                        type="button"
                        className="stop-map-action"
                        aria-label="View on map"
                        aria-description={directory_ref?.subtitle}
                        onClick={() => setShowMap(true)}
                      >
                        <Icon name="map" size={19} />
                        <span>
                          View on map
                          {directory_ref?.subtitle && <small>{directory_ref.subtitle}</small>}
                        </span>
                        <Icon name="next" size={15} />
                      </button>
                    ) : (
                      directory_ref?.subtitle && (
                        <p className="stop-place-address">
                          <Icon name="pin" size={15} /> {directory_ref.subtitle}
                        </p>
                      )
                    )}
                    <label className="stop-setting">
                      Category
                      <span className="stop-setting-control stop-category-control">
                        <select
                          value={kind}
                          onChange={(e) => chooseKind(e.target.value as StopKind)}
                        >
                          {stop_kinds.map((value) => (
                            <option key={value} value={value}>
                              {stop_kind_labels[value]}
                            </option>
                          ))}
                        </select>
                        <Icon name="next" size={14} />
                      </span>
                    </label>
                  </div>
                  <div
                    className="stop-schedule"
                    role="group"
                    aria-label={kind === 'stay' ? 'Stay dates and time' : 'Stop date and time'}
                  >
                    <ScheduleField
                      label={kind === 'stay' ? 'Check-in date' : 'Day'}
                      type="date"
                      required
                      value={stop_day}
                      onChange={changeDay}
                    />
                    {kind === 'stay' && (
                      <ScheduleField
                        label="Check-out date"
                        type="date"
                        min={checkoutAfter(stop_day, 1) || undefined}
                        value={checkout}
                        onChange={setCheckout}
                        detail={
                          nights > 0 ? `${nights} ${nights === 1 ? 'night' : 'nights'}` : undefined
                        }
                      />
                    )}
                    <ScheduleField label="Time" type="time" value={time} onChange={setTime} />
                  </div>
                  <label className="stop-notes">
                    <span>
                      Notes <span className="optional">(optional)</span>
                    </span>
                    <textarea
                      rows={2}
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
                <footer className="dialog-footer stop-form-footer">
                  {error && (
                    <p className="form-error" role="alert">
                      {error}
                    </p>
                  )}
                  {discard ? (
                    <DiscardPrompt
                      disabled={busy}
                      onKeep={() => setDiscard(false)}
                      onDiscard={onCancel}
                    />
                  ) : (
                    <div className="stop-form-actions">
                      <button type="button" className="secondary" disabled={busy} onClick={dismiss}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="primary"
                        disabled={busy || !title.trim() || !stop_day}
                        onClick={save}
                      >
                        {busy
                          ? 'Saving…'
                          : stop
                            ? 'Save changes'
                            : day_label.startsWith('Day ')
                              ? `Add to ${day_label}`
                              : 'Add to itinerary'}
                      </button>
                    </div>
                  )}
                </footer>
              </>
            )}
          </EditorForm>
        )}
      </Dialog>
      {show_map && position && (
        <Dialog
          title="Place map"
          back_label="Back to stop"
          full_screen
          onDismiss={() => setShowMap(false)}
        >
          <Suspense
            fallback={
              <p className="map-loading" role="status">
                Opening map…
              </p>
            }
          >
            <PlaceMapPreview
              title={title.trim() || 'Selected place'}
              position={position}
              context={place_context}
              stops={preview_stops}
              editing_id={stop?.id}
              native={native}
            />
          </Suspense>
        </Dialog>
      )}
    </>
  );
}
