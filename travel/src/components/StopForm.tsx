import { lazy, Suspense, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { citiesOnDay, cityIndicesOnDay } from '../lib/city-days';
import { daysBetween, isCalendarDate, itineraryDayLabel } from '../lib/dates';
import { createId } from '../lib/identity';
import { placeTypeLabel } from '../lib/place-types';
import {
  plannedStopCityIndex,
  searchCityLabel,
  suggestRouteAnchor,
} from '../lib/planned-stop-search';
import { searchCities, useSearchCityLocations } from '../lib/use-search-cities';
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
import { StopPlacePicker, type PickerCity } from './StopPlacePicker';
import { checkoutAfter, continuingStays } from '../lib/hotel-stays';
import { StayDates } from './StayDates';

const PlaceMapPreview = lazy(() => import('./PlaceMapPreview'));

interface StopFormProps {
  trip: Trip;
  trip_stops: PlannedStop[];
  day: string;
  first: string;
  initial_category?: StopSearchCategory;
  stop?: PlannedStop;
  native: boolean;
  lookup: StopLookup;
  onSave(stop: PlannedStop, before_stop_id?: string | null): Promise<void>;
  onCancel(): void;
  onDelete?(stop: PlannedStop): void;
}

type StayDateAction =
  | { from: 'dates'; trigger: HTMLElement }
  | {
      from: 'review';
      stop: PlannedStop;
      city_label?: string;
      trigger: HTMLElement | null;
      another: boolean;
    }
  | {
      from: 'result';
      stop: PlannedStop;
      city_label: string;
      trigger: HTMLElement;
      row: HTMLElement;
    };

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
    dates_confirmed: false,
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
  required,
}: {
  label: string;
  type: 'date' | 'time';
  value: string;
  onChange(value: string): void;
  required?: boolean;
}) {
  let formatted = type === 'date' ? 'Set date' : 'Set time';
  if (type === 'date' && isCalendarDate(value))
    formatted = date_format.format(new Date(value + 'T00:00:00Z'));
  if (type === 'time' && value)
    formatted = time_format.format(new Date('2000-01-01T' + value + 'Z'));
  return (
    <label className="stop-setting">
      <span>{label}</span>
      <span className="stop-setting-control">
        <span className="stop-touch-value" aria-hidden="true">
          {formatted}
        </span>
        <input
          aria-label={label}
          type={type}
          value={value}
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
  first,
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
  const [confirmation, setConfirmation] = useState<{ id: string; message: string }>();
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
  const [date_action, setDateAction] = useState<StayDateAction | null>(null);
  const hotel_to_add = date_action && date_action.from !== 'dates' ? date_action.stop : undefined;
  const picking_dates = date_action?.from === 'result';
  const primary_button = useRef<HTMLButtonElement>(null);
  const another_button = useRef<HTMLButtonElement>(null);
  const date_description = useId();
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
  const route_day = picking && picker_day ? picker_day : stop_day;
  const route = picking && picker_day ? picker_stops : preview_stops;
  const scheduled_cities = useMemo(
    () => searchCities(trip, cityIndicesOnDay(trip, route_day)),
    [trip, route_day],
  );
  const day_cities = useSearchCityLocations(
    scheduled_cities,
    scheduled_cities.length > 1 && route.some((item) => item.position || item.city_id),
  );
  const city_labels = useMemo(() => {
    if (day_cities.cities.length < 2) return;
    const labels = new Map<string, string>();
    for (const item of route) {
      const index = plannedStopCityIndex(item, day_cities.cities, route_day);
      if (index !== undefined) labels.set(item.id, searchCityLabel(scheduled_cities, index));
    }
    return labels;
  }, [day_cities.cities, route, route_day, scheduled_cities]);
  const other_stops = preview_stops.filter((item) => item.id !== draft_id);
  const existing_index = preview_stops.findIndex((item) => item.id === draft_id);
  const original_index = existing_index < 0 ? other_stops.length : existing_index;
  const placement_pending =
    day_cities.loading &&
    !stop &&
    !picking &&
    chosen_before === undefined &&
    Boolean(city || city_id) &&
    kind !== 'stay' &&
    kind !== 'transport';
  const suggested_before =
    !stop && !picking
      ? suggestRouteAnchor(day_cities.cities, other_stops, draft, stop_day)
      : undefined;
  const anchor = chosen_before === undefined ? suggested_before : chosen_before;
  const anchor_index = other_stops.findIndex((item) => item.id === anchor);
  const fallback_index = anchor === null ? other_stops.length : original_index;
  const insertion_index = anchor_index >= 0 ? anchor_index : fallback_index;
  const before_stop_id =
    insertion_index === original_index ? undefined : (other_stops[insertion_index]?.id ?? null);
  const last_pick = useRef<HTMLElement | null>(null);
  const change_place = useRef<HTMLButtonElement>(null);
  const picker_pane = useRef<HTMLDivElement>(null);
  const date_return_focus = useRef<Array<HTMLElement | null>>([]);
  useLayoutEffect(() => {
    if (picking && last_pick.current) {
      const target = last_pick.current.isConnected ? last_pick.current : picker_pane.current;
      target?.focus({ preventScroll: true });
    } else if (!picking && picker_day && (stop || directory_ref)) {
      change_place.current?.focus({ preventScroll: true });
    }
  }, [picking, picker_day, directory_ref, stop]);
  useLayoutEffect(() => {
    if (date_action || !date_return_focus.current.length) return;
    // Child dialogs have now reopened. Focusing sooner can leave WebKit on the map's Back button.
    const target = date_return_focus.current.find((element) => element?.isConnected);
    date_return_focus.current = [];
    target?.focus({ preventScroll: true });
  }, [date_action]);
  function staySummary() {
    if (!isCalendarDate(stop_day)) return 'Choose check-in';
    const start = new Date(stop_day + 'T00:00:00Z');
    const arrival = itineraryDayLabel(stop_day, first, trip);
    if (!isCalendarDate(checkout) || checkout <= stop_day)
      return `${date_format.format(start)} · ${arrival} · Check-out open`;
    const range = date_format.formatRange(start, new Date(checkout + 'T00:00:00Z'));
    const departure = itineraryDayLabel(checkout, first, trip);
    const days = arrival === departure ? arrival : `${arrival} → ${departure}`;
    const nights = daysBetween(stop_day, checkout);
    return `${range} · ${days} · ${nights} ${nights === 1 ? 'night' : 'nights'}`;
  }
  const dirty =
    (chosen_before !== undefined && insertion_index !== original_index) ||
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
  const visit_index = city_id
    ? plannedStopCityIndex({ city, city_id, day: stop_day, position }, scheduled_cities, stop_day)
    : undefined;
  const planning_city =
    visit_index === undefined ? city : searchCityLabel(scheduled_cities, visit_index);
  const place_context = [
    day_label,
    planning_city || citiesOnDay(trip, stop_day).join(' → ') || trip.title,
  ]
    .filter(Boolean)
    .join(' · ');
  const needs_stay_dates = kind === 'stay' && !stop && !draft.dates_confirmed;

  function stayDatesFor(value: StopKind) {
    return {
      checkout: value === 'stay' && kind !== 'stay' ? checkoutAfter(stop_day, 1) : checkout,
      dates_confirmed: value === 'stay' && kind === 'stay' && draft.dates_confirmed,
    };
  }

  function onlyInspectedPlace() {
    const choice = inspected.current;
    if (!choice) return false;
    const fields = Object.keys(draft) as (keyof typeof draft)[];
    return fields.every((field) => draft[field] === choice[field]);
  }

  function openResults(mode: 'initial' | 'change') {
    const search_day = isCalendarDate(stop_day) ? stop_day : day;
    if (picker_day !== search_day) {
      setPickerCategory(
        directory_ref?.provider === 'ourairports' ? 'airport' : search_categories[kind],
      );
      setPickerDay(search_day);
      setConfirmation(undefined);
    }
    // Inspecting a result leaves the picker ready for a quick add. Keep edited drafts for review.
    if (mode === 'initial' && !error && onlyInspectedPlace()) {
      setDraft(stopDraft(search_day));
      inspected.current = null;
    }
    setPicking(mode);
  }

  function closeDates(applied = false) {
    if (!date_action) return;
    // A saved result replaces its calendar button. A different check-in day replaces the results.
    date_return_focus.current =
      date_action.from === 'result'
        ? [applied ? null : date_action.trigger, date_action.row, picker_pane.current]
        : [date_action.trigger];
    setDateAction(null);
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
      ...stayDatesFor(place.kind),
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
      ...stayDatesFor(suggested_kind),
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

  function resumePicking(saved: PlannedStop, before?: string | null) {
    const label = trip.start_date ? itineraryDayLabel(saved.day, day, trip) : '';
    const destination = label.startsWith('Day ')
      ? label
      : date_format.format(new Date(saved.day + 'T00:00:00Z'));
    const next = trip_stops.find((item) => item.id === before);
    const placement = next ? ` before ${next.title}` : '';
    setConfirmation({
      id: saved.id,
      message: `${saved.title} added to ${destination}${placement}.`,
    });
    setDraft(stopDraft(saved.day));
    inspected.current = null;
    setPickerDay(saved.day);
    setPicking('initial');
  }

  function pickedStop(
    place: StopSearchResult,
    date: string,
    city?: string,
    city_id?: string,
  ): PlannedStop {
    return {
      id: draft_id,
      trip_id: trip.id,
      day: date,
      title: place.title,
      kind: place.kind,
      city,
      city_id,
      notes: '',
      time: '',
      position: place.position,
      directory_ref: directoryReference(place),
    };
  }

  function scheduleStay(place: StopSearchResult, row: HTMLElement, scope: PickerCity) {
    const hotel = pickedStop(place, picker_day ?? day, scope.name, scope.id);
    hotel.checkout_date = checkoutAfter(hotel.day, 1) || undefined;
    const trigger =
      document.activeElement instanceof HTMLButtonElement ? document.activeElement : row;
    setDateAction({ from: 'result', stop: hotel, city_label: scope.label, row, trigger });
  }

  async function quickAdd(place: StopSearchResult, city?: string, city_id?: string) {
    const value = pickedStop(place, picker_day ?? day, city, city_id);
    setBusy(true);
    try {
      const cities = day_cities.loading ? await day_cities.resolve() : day_cities.cities;
      const before = suggestRouteAnchor(cities, picker_stops, value, value.day);
      await onSave(value, before);
      resumePicking(value, before);
    } finally {
      setBusy(false);
    }
  }

  async function submit(another = false) {
    if (busy) return;
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
      if (needs_stay_dates) {
        const trigger = another ? another_button.current : primary_button.current;
        setDateAction({ from: 'review', stop: value, city_label: planning_city, another, trigger });
        return;
      }
      await saveReviewed(value, another);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save this stop.');
    }
  }

  async function saveReviewed(value: PlannedStop, another: boolean) {
    setBusy(true);
    try {
      const before =
        value.day !== stop_day
          ? undefined
          : placement_pending
            ? suggestRouteAnchor(await day_cities.resolve(), other_stops, value, stop_day)
            : before_stop_id;
      await onSave(value, before);
      if (another) {
        resumePicking(value, before);
      } else {
        onFinish();
      }
    } finally {
      setBusy(false);
    }
  }

  async function applyDates(day: string, checkout: string) {
    if (!date_action) return;
    if (date_action.from === 'dates') {
      updateDraft({
        day,
        checkout,
        dates_confirmed: true,
        ...(day !== stop_day && { before_stop_id: undefined }),
      });
      return;
    }
    const hotel = { ...date_action.stop, day, checkout_date: checkout || undefined };
    if (date_action.from === 'review') {
      await saveReviewed(hotel, date_action.another);
    } else {
      await onSave(hotel);
      resumePicking(hotel);
    }
  }

  return (
    <>
      <Dialog
        title={
          picking
            ? picker_titles[picker_category]
            : kind === 'stay'
              ? stop
                ? 'Edit hotel stay'
                : 'Hotel stay'
              : stop
                ? 'Edit stop'
                : 'Add stop'
        }
        full_screen
        dismiss_disabled={busy}
        back_label={!stop && !picking && !discard ? 'Back to place results' : undefined}
        dismiss_label={
          !stop && !picking && !discard
            ? 'Cancel'
            : picking && !dirty && confirmation
              ? 'Done'
              : undefined
        }
        onDismiss={dismiss}
        onBack={!stop && !picking && !discard ? () => openResults('initial') : dismiss}
      >
        {picker_day !== null && (
          <div
            ref={picker_pane}
            tabIndex={-1}
            className="stop-picker-pane"
            hidden={!picking || picking_dates}
          >
            <StopPlacePicker
              key={picker_day}
              trip={trip}
              native={native}
              active={Boolean(picking) && !covered && !picking_dates}
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
              saved_message={confirmation?.message}
              saved_stop_id={confirmation?.id}
              onQuickAdd={picking === 'initial' && !dirty && !source_changed ? quickAdd : undefined}
              onScheduleStay={
                !stop && picking === 'initial' && !dirty && !source_changed
                  ? scheduleStay
                  : undefined
              }
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
                      onClick={() => openResults('change')}
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
                        disabled={placement_pending}
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
                            updateDraft({ kind, ...stayDatesFor(kind) });
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
                    {kind === 'stay' ? (
                      <button
                        className="stop-route-position stop-stay-dates"
                        type="button"
                        aria-label="Change stay dates"
                        aria-describedby={date_description}
                        aria-haspopup="dialog"
                        aria-expanded={date_action?.from === 'dates'}
                        onClick={(event) =>
                          setDateAction({ from: 'dates', trigger: event.currentTarget })
                        }
                      >
                        <span>Stay dates</span>
                        <small id={date_description}>{staySummary()}</small>
                        <Icon name="next" size={15} />
                      </button>
                    ) : (
                      <ScheduleField
                        label="Day"
                        type="date"
                        required
                        value={stop_day}
                        onChange={(day) => {
                          if (day !== stop_day) updateDraft({ day, before_stop_id: undefined });
                        }}
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
                      city_labels={city_labels}
                      pending={placement_pending}
                      onChange={(id) => updateDraft({ before_stop_id: id })}
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
                          ref={another_button}
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
                        ref={primary_button}
                        type="button"
                        className="primary"
                        disabled={busy || !title.trim() || !stop_day}
                        onClick={save}
                      >
                        {busy
                          ? 'Saving…'
                          : stop
                            ? 'Save changes'
                            : needs_stay_dates
                              ? 'Choose stay dates'
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
      {date_action && (
        <StayDates
          trip={trip}
          first={first}
          hotel={
            date_action.from === 'dates'
              ? undefined
              : { title: date_action.stop.title, city: date_action.city_label }
          }
          check_in={hotel_to_add?.day ?? stop_day}
          check_out={hotel_to_add ? (hotel_to_add.checkout_date ?? '') : checkout}
          initial_field={isCalendarDate(hotel_to_add?.day ?? stop_day) ? 'check_out' : 'check_in'}
          onApply={applyDates}
          onClose={closeDates}
        />
      )}
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
