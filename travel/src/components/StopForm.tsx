import { lazy, Suspense, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { citiesOnDay } from '../lib/city-days';
import { daysBetween, isCalendarDate, itineraryDayLabel, offsetDay } from '../lib/dates';
import { createId } from '../lib/identity';
import { placeTypeLabel } from '../lib/place-types';
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
import { RoutePosition } from './RoutePosition';
import { Icon } from './Icon';
import { StopPlacePicker } from './StopPlacePicker';
import { continuingStays } from '../lib/hotel-stays';

const PlaceMapPreview = lazy(() => import('./PlaceMapPreview'));

interface StopFormProps {
  trip: Trip;
  trip_stops: PlannedStop[];
  day: string;
  initial_category?: StopSearchCategory;
  stop?: PlannedStop;
  native: boolean;
  lookup: StopLookup;
  onSave(stop: PlannedStop, before_stop_id?: string | null): Promise<void>;
  onCancel(): void;
  onDelete?(stop: PlannedStop): void;
}

function checkoutAfter(day: string, nights: number) {
  if (!isCalendarDate(day) || day === '9999-12-31') return '';
  return offsetDay(day, Math.min(nights, daysBetween(day, '9999-12-31')));
}

function stopDraft(day: string, stop?: PlannedStop) {
  return {
    id: stop?.id ?? createId(),
    directory_ref: stop?.directory_ref,
    city: stop?.city,
    city_id: stop?.city_id,
    title: stop?.title ?? '',
    day: stop?.day ?? day,
    before_stop_id: undefined as string | null | undefined,
    checkout: stop?.checkout_date ?? '',
    kind: stop?.kind ?? 'sight',
    time: stop?.time ?? '',
    notes: stop?.notes ?? '',
    latitude: stop?.position?.latitude.toString() ?? '',
    longitude: stop?.position?.longitude.toString() ?? '',
  };
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

function directoryReference(place: StopSearchResult) {
  return {
    provider: place.source,
    id: place.id,
    ...(place.place_type && { place_type: place.place_type }),
    ...(place.subtitle && { subtitle: place.subtitle.slice(0, text_limits.place_locality) }),
  };
}

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
      <StopEditor
        {...props}
        covered={Boolean(planned)}
        onFinish={props.onCancel}
        onEditPlanned={props.stop ? undefined : setPlanned}
      />
      {planned && (
        <StopEditor
          {...props}
          key={planned.id}
          stop={planned}
          initial_category={undefined}
          onFinish={props.onCancel}
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
  onFinish,
  onDelete,
  onEditPlanned,
  covered = false,
  native,
}: StopFormProps & {
  covered?: boolean;
  onFinish(): void;
  onEditPlanned?(stop: PlannedStop): void;
}) {
  const [draft, setDraft] = useState(() => stopDraft(day, stop));
  const inspected = useRef<typeof draft | null>(null);
  const {
    id: draft_id,
    directory_ref,
    city,
    city_id,
    title,
    day: stop_day,
    before_stop_id: chosen_before,
    checkout,
    kind,
    time,
    notes,
    latitude,
    longitude,
  } = draft;
  function updateDraft(fields: Partial<typeof draft>) {
    setDraft((previous) => ({ ...previous, ...fields }));
  }
  const [saved_message, setSavedMessage] = useState('');
  const [picking, setPicking] = useState<'initial' | 'change' | null>(stop ? null : 'initial');
  const [picker_day, setPickerDay] = useState<string | null>(stop ? null : day);
  const [picker_category, setPickerCategory] = useState<StopSearchCategory>(
    initial_category ??
      (stop?.directory_ref?.provider === 'ourairports'
        ? 'airport'
        : search_categories[stop?.kind ?? 'sight']),
  );
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
  const picker_stops = useMemo(
    () => trip_stops.filter((item) => item.day === picker_day),
    [trip_stops, picker_day],
  );
  const picker_stays = useMemo(
    () => (picker_day ? continuingStays(trip_stops, picker_day) : []),
    [trip_stops, picker_day],
  );
  const other_stops = preview_stops.filter((item) => item.id !== draft_id);
  const existing_index = preview_stops.findIndex((item) => item.id === draft_id);
  const default_index = existing_index < 0 ? other_stops.length : existing_index;
  const chosen_index =
    chosen_before === null
      ? other_stops.length
      : other_stops.findIndex((item) => item.id === chosen_before);
  const insertion_index = chosen_index < 0 ? default_index : chosen_index;
  const before_stop_id = insertion_index === default_index ? undefined : chosen_before;
  const last_pick = useRef<HTMLElement | null>(null);
  const change_place = useRef<HTMLButtonElement>(null);
  const picker_pane = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (picking && last_pick.current) {
      const target = last_pick.current.isConnected ? last_pick.current : picker_pane.current;
      target?.focus({ preventScroll: true });
    } else if (!picking && picker_day && (stop || directory_ref)) {
      change_place.current?.focus({ preventScroll: true });
    }
  }, [picking, picker_day, directory_ref, stop]);
  const nights =
    kind === 'stay' && isCalendarDate(stop_day) && isCalendarDate(checkout)
      ? daysBetween(stop_day, checkout)
      : 0;
  const dirty =
    before_stop_id !== undefined ||
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
    directory_ref?.place_type !== stop?.directory_ref?.place_type ||
    directory_ref?.subtitle !== stop?.directory_ref?.subtitle;
  const place_description = [
    directory_ref?.place_type && placeTypeLabel(directory_ref.place_type),
    directory_ref?.subtitle,
  ]
    .filter(Boolean)
    .join(' · ');
  const day_label =
    trip.start_date && isCalendarDate(stop_day) ? itineraryDayLabel(stop_day, day, trip) : '';
  const place_context = [day_label, city || citiesOnDay(trip, stop_day).join(' → ') || trip.title]
    .filter(Boolean)
    .join(' · ');

  function checkoutFor(value: StopKind) {
    return value === 'stay' && kind !== 'stay' ? checkoutAfter(stop_day, 1) : checkout;
  }

  function onlyInspectedPlace() {
    const choice = inspected.current;
    if (!choice) return false;
    const fields = Object.keys(draft) as (keyof typeof draft)[];
    return fields.every((field) => draft[field] === choice[field]);
  }

  function backToResults() {
    // Inspecting a directory result should leave the other places available to add.
    // Keep a draft that has been edited or needs a save retry.
    if (!error && onlyInspectedPlace()) {
      setDraft(stopDraft(day));
      inspected.current = null;
    }
    setPicking('initial');
  }

  function changeDay(value: string) {
    if (value === stop_day) return;
    updateDraft({
      day: value,
      before_stop_id: undefined,
      checkout:
        kind === 'stay' && isCalendarDate(value) && isCalendarDate(checkout)
          ? checkoutAfter(value, Math.max(1, nights))
          : checkout,
    });
  }

  function choosePlace(
    place: StopSearchResult,
    origin: HTMLElement,
    city?: string,
    city_id?: string,
  ) {
    last_pick.current = origin;
    if (
      picking === 'initial' &&
      directory_ref?.provider === place.source &&
      directory_ref.id === place.id &&
      city === draft.city &&
      city_id === draft.city_id
    ) {
      setPicking(null);
      return;
    }
    const choice = {
      ...draft,
      title: place.title,
      city,
      city_id,
      kind: place.kind,
      checkout: checkoutFor(place.kind),
      latitude: String(place.position.latitude),
      longitude: String(place.position.longitude),
      directory_ref: directoryReference(place),
    };
    inspected.current =
      !stop && ((!dirty && !source_changed) || onlyInspectedPlace()) ? choice : null;
    setDraft(choice);
    setPicking(null);
    setError('');
  }

  function enterManually(
    name: string,
    suggested_kind: StopKind,
    origin: HTMLElement,
    city?: string,
    city_id?: string,
  ) {
    last_pick.current = origin;
    inspected.current = null;
    updateDraft({
      title: picking === 'change' && !name ? title : name,
      city,
      city_id,
      kind: suggested_kind,
      checkout: checkoutFor(suggested_kind),
      directory_ref: undefined,
      ...((picking !== 'change' || (name && name !== title)) && { latitude: '', longitude: '' }),
    });
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

  function resumePicking(saved: PlannedStop) {
    const label = trip.start_date ? itineraryDayLabel(saved.day, day, trip) : '';
    const destination = label.startsWith('Day ')
      ? label
      : date_format.format(new Date(saved.day + 'T00:00:00Z'));
    setSavedMessage(`${saved.title} added to ${destination}.`);
    setDraft(stopDraft(saved.day));
    inspected.current = null;
    setPickerDay(saved.day);
    setPicking('initial');
  }

  async function quickAdd(place: StopSearchResult, city?: string, city_id?: string) {
    const value: PlannedStop = {
      id: draft_id,
      trip_id: trip.id,
      day: picker_day ?? day,
      title: place.title,
      kind: place.kind,
      city,
      city_id,
      notes: '',
      time: '',
      position: place.position,
      directory_ref: directoryReference(place),
    };
    setBusy(true);
    try {
      await onSave(value);
      resumePicking(value);
    } finally {
      setBusy(false);
    }
  }

  async function submit(another = false) {
    if (busy) return;
    setBusy(true);
    setError('');
    setDiscard(false);
    try {
      const value: PlannedStop = {
        id: draft_id,
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
      };
      await onSave(value, before_stop_id);
      if (another) {
        resumePicking(value);
      } else {
        onFinish();
      }
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
        back_label={!stop && !picking && !discard ? 'Back to place results' : undefined}
        dismiss_label={
          !stop && !picking && !discard
            ? 'Cancel'
            : picking && !dirty && saved_message
              ? 'Done'
              : undefined
        }
        onDismiss={dismiss}
        onBack={!stop && !picking && !discard ? backToResults : dismiss}
      >
        {picker_day !== null && (
          <div ref={picker_pane} tabIndex={-1} className="stop-picker-pane" hidden={!picking}>
            <StopPlacePicker
              key={picker_day}
              trip={trip}
              native={native}
              active={Boolean(picking) && !covered}
              day={picker_day}
              initial_city={city}
              initial_city_id={city_id}
              initial_category={picker_category}
              onCategoryChange={setPickerCategory}
              route={picker_stops}
              stays={picker_stays}
              lookup={lookup}
              onPick={choosePlace}
              onManual={enterManually}
              saved_message={saved_message}
              onQuickAdd={picking === 'initial' && !dirty && !source_changed ? quickAdd : undefined}
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
                        onChange={(e) => updateDraft({ title: e.target.value })}
                      />
                    </label>
                    {position ? (
                      <button
                        type="button"
                        className="stop-map-action"
                        aria-label="View on map"
                        aria-description={place_description || undefined}
                        onClick={() => setShowMap(true)}
                      >
                        <Icon name="map" size={19} />
                        <span>
                          View on map
                          {place_description && <small>{place_description}</small>}
                        </span>
                        <Icon name="next" size={15} />
                      </button>
                    ) : (
                      place_description && (
                        <p className="stop-place-address">
                          <Icon name="pin" size={15} /> {place_description}
                        </p>
                      )
                    )}
                    <label className="stop-setting">
                      Category
                      <span className="stop-setting-control stop-category-control">
                        <select
                          value={kind}
                          onChange={(e) => {
                            const kind = e.target.value as StopKind;
                            updateDraft({ kind, checkout: checkoutFor(kind) });
                          }}
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
                        onChange={(checkout) => updateDraft({ checkout })}
                        detail={
                          nights > 0 ? `${nights} ${nights === 1 ? 'night' : 'nights'}` : undefined
                        }
                      />
                    )}
                    <ScheduleField
                      label="Time"
                      type="time"
                      value={time}
                      onChange={(time) => updateDraft({ time })}
                    />
                    <RoutePosition
                      stops={other_stops}
                      index={insertion_index}
                      title={title.trim() || (kind === 'stay' ? 'New hotel stay' : 'New stop')}
                      context={place_context}
                      onChange={(id) =>
                        updateDraft({
                          before_stop_id:
                            id === (other_stops[default_index]?.id ?? null) ? undefined : id,
                        })
                      }
                    />
                  </div>
                  <label className="stop-notes">
                    <span>
                      Notes <span className="optional">(optional)</span>
                    </span>
                    <textarea
                      rows={2}
                      maxLength={text_limits.stop_notes}
                      value={notes}
                      onChange={(e) => updateDraft({ notes: e.target.value })}
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
                      onLatitude={(latitude) => updateDraft({ latitude })}
                      onLongitude={(longitude) => updateDraft({ longitude })}
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
                    <div className={`stop-form-actions${stop ? '' : ' stop-add-actions'}`}>
                      {stop ? (
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy}
                          onClick={dismiss}
                        >
                          Cancel
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy || !title.trim() || !stop_day}
                          onClick={(event) => {
                            if (event.currentTarget.form?.reportValidity()) void submit(true);
                          }}
                        >
                          Add and choose another
                        </button>
                      )}
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
              stays={continuingStays(trip_stops, stop_day)}
              editing_id={draft_id}
              insertion_index={insertion_index}
              native={native}
            />
          </Suspense>
        </Dialog>
      )}
    </>
  );
}
