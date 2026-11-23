import { Fragment, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { confirmsInput } from '../lib/keyboard';
import { cityIndicesOnDay } from '../lib/city-days';
import type { ContinuingStay } from '../lib/hotel-stays';
import { dayPlaceResult, nearestFirst } from '../lib/place-comparison';
import { placeTypeFilters, type PlaceTypeFilter } from '../lib/place-types';
import { isCalendarDate, itineraryDayLabel } from '../lib/dates';
import { text_limits } from '../lib/model';
import {
  matchesPlannedPlace,
  searchCityLabel,
  searchPlannedStops,
} from '../lib/planned-stop-search';
import { searchCities, useSearchCityLocations } from '../lib/use-search-cities';
import { usePlaceSuggestions } from '../lib/use-place-suggestions';
import { usePlaceSearchViewport } from '../lib/use-place-search-viewport';
import {
  groupPlacesForCity,
  type StopLookup,
  type StopSearchRequest,
  type StopSearchResult,
} from '../lib/stop-lookup';
import type { PlannedStop, StopKind, Trip } from '../lib/types';
import { Icon } from './Icon';
import { PlannedSearchResult, StopPlaceResult } from './StopPlaceResult';
import { PlaceResultsSheet } from './PlaceResultsSheet';
import { PlaceSortButton, type PlaceSortOrder } from './PlaceSortButton';
import { PlaceTypeFilterButton } from './PlaceTypeFilterButton';
import '../stop-place-picker.css';

const categories = [
  ['sight', 'Sights', 'landmark'],
  ['stay', 'Hotels', 'bed'],
  ['food', 'Food', 'food'],
  ['airport', 'Airports', 'plane'],
  ['all', 'Places', 'compass'],
] as const;

const date_format = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

type SearchInput = {
  text: string;
  submitted: string | null;
  type_filter?: PlaceTypeFilter;
  sort?: PlaceSortOrder;
};
const empty_search: SearchInput = { text: '', submitted: '' };

export interface PickerCity {
  name: string;
  id?: string;
  label: string;
}

function searchKey(
  category: StopSearchRequest['category'],
  index: number | undefined,
  city: string,
) {
  return category === 'airport' ? 'airport' : JSON.stringify([category, index, city]);
}

export function StopPlacePicker({
  trip,
  active,
  native,
  day,
  lookup,
  initial_category = 'sight',
  initial_city,
  initial_city_id,
  route,
  stays,
  saved_message = '',
  saved_stop_id,
  onCategoryChange,
  onEditPlanned,
  onQuickAdd,
  onScheduleStay,
  onPick,
  onManual,
}: {
  trip: Trip;
  active: boolean;
  native: boolean;
  day: string;
  lookup: StopLookup;
  initial_category?: StopSearchRequest['category'];
  initial_city?: string;
  initial_city_id?: string;
  route: PlannedStop[];
  stays: ContinuingStay[];
  saved_message?: string;
  saved_stop_id?: string;
  onCategoryChange?(category: StopSearchRequest['category']): void;
  onEditPlanned?(stop: PlannedStop): void;
  onQuickAdd?(place: StopSearchResult, city?: string, city_id?: string): Promise<void>;
  onScheduleStay?(place: StopSearchResult, origin: HTMLElement, scope: PickerCity): void;
  onPick(place: StopSearchResult, origin: HTMLElement, city?: string, city_id?: string): void;
  onManual(
    name: string,
    kind: StopKind,
    origin: HTMLElement,
    city?: string,
    city_id?: string,
  ): void;
}) {
  const cities = trip.cities ?? [];
  // Only occupied nights mark a result as already planned. The checkout hotel stays on the map.
  const day_stops = useMemo(
    () => [
      ...route,
      ...stays.filter(({ stop }) => stop.checkout_date !== day).map(({ stop }) => stop),
    ],
    [route, stays, day],
  );
  const day_indices = useMemo(() => cityIndicesOnDay(trip, day), [trip, day]);
  const options = useMemo(
    () => (day_indices.length ? day_indices : (trip.cities ?? []).map((_, index) => index)),
    [trip.cities, day_indices],
  );
  const route_cities = useMemo(() => searchCities(trip, options), [options, trip]);
  const [category, setCategory] = useState(initial_category);
  const [chosen_city, setChosenCity] = useState<number | undefined>(() => {
    if (initial_city_id) {
      const match = options.find((index) => trip.city_locations?.[index]?.id === initial_city_id);
      if (match !== undefined) return match;
    }
    const names = options.filter(
      (index) =>
        cities[index] === initial_city && (!initial_city_id || !trip.city_locations?.[index]?.id),
    );
    return names.length === 1 ? names[0] : undefined;
  });
  const [custom_city, setCustomCity] = useState(!cities.length ? (initial_city ?? '') : '');
  const [searches, setSearches] = useState<Record<string, SearchInput>>({});
  const [composing, setComposing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [map_open, setMapOpen] = useState(false);
  const [map_selections, setMapSelections] = useState<Record<string, string>>({});
  const map_button = useRef<HTMLButtonElement>(null);
  const results_heading = useRef<HTMLHeadingElement>(null);
  const heading_id = useId();
  const return_to_map_button = useRef(false);
  const [adding_id, setAddingId] = useState<string | null>(null);
  const [save_error, setSaveError] = useState<{ id: string; message: string }>();
  const saving = useRef(false);
  const return_focus = useRef<HTMLElement | null>(null);
  const input = useRef<HTMLInputElement>(null);
  usePlaceSearchViewport(input);
  const category_strip = useRef<HTMLDivElement>(null);
  const airports = category === 'airport';
  const is_browsable = category === 'sight' || category === 'stay';
  const default_city = category === 'stay' ? day_indices.at(-1) : day_indices[0];
  const city_index = chosen_city ?? default_city;
  const city = city_index === undefined ? custom_city.trim() : cities[city_index];
  const location = city_index === undefined ? null : trip.city_locations?.[city_index];
  const scoped_city = airports || !city ? undefined : city;
  const scoped_id = airports ? undefined : location?.id;
  const scope_key = searchKey(category, city_index, city);
  const {
    text: query,
    submitted: submitted_query,
    type_filter,
    sort = 'directory',
  } = searches[scope_key] ?? empty_search;
  const needs_centers = Boolean(
    onEditPlanned &&
      !airports &&
      (query.trim() || type_filter) &&
      route_cities.some((item) => !item.location) &&
      day_stops.some(
        (stop) => stop.city_id || (stop.position && (route_cities.length > 1 || stop.day !== day)),
      ),
  );
  const resolved = useSearchCityLocations(route_cities, needs_centers);
  const can_search = Boolean(query.trim() && (airports || city));
  const can_browse = is_browsable && city_index !== undefined;
  // Saving reparses city objects. Preserve the lookup when its search area hasn't changed.
  const scope = useMemo(
    () => ({
      category,
      city: airports ? '' : city,
      location: airports ? null : location,
      type_filter,
    }),
    [
      category,
      airports,
      city,
      city_index,
      location?.id,
      location?.country_code,
      location?.latitude,
      location?.longitude,
      type_filter,
    ],
  );
  const suggestions = usePlaceSuggestions(
    lookup,
    scope,
    query,
    submitted_query,
    can_browse,
    active,
    composing,
  );
  const {
    places: response_places,
    loading,
    error,
    filter_nearby: filtering,
    named_term,
  } = suggestions;
  const scoped = useMemo(
    () =>
      response_places && !airports && city_index !== undefined
        ? groupPlacesForCity(response_places, trip, options, city_index)
        : undefined,
    [response_places, airports, city_index, trip, options],
  );
  const places = scoped?.places ?? response_places;
  const can_compare =
    is_browsable &&
    (route.some((stop) => stop.position) || stays.some(({ stop }) => stop.position));
  const results = useMemo(() => {
    const rows = places?.map((place) =>
      dayPlaceResult(place, day_stops, route, stays, can_compare),
    );
    return can_compare && sort === 'route' ? rows?.sort(nearestFirst) : rows;
  }, [places, day_stops, route, stays, can_compare, sort]);
  const selection_key = JSON.stringify([scope_key, type_filter, query.trim()]);
  const selected_id = map_selections[selection_key];
  const current_place = results?.find(({ place }) => place.id === selected_id) ?? results?.[0];
  const other_cities = named_term ? (scoped?.other_cities ?? []) : [];
  const planned =
    onEditPlanned && city && (query.trim() || type_filter) && !airports
      ? searchPlannedStops(
          day_stops,
          query,
          category,
          resolved.cities,
          city_index,
          day,
          custom_city,
          type_filter,
        ).filter((stop) => !places?.some((place) => matchesPlannedPlace(stop, place)))
      : [];
  const category_label = categories.find(([key]) => key === category)![1];
  const scoped_label = city_index === undefined ? city : cityLabel(city_index);
  const type_label =
    type_filter && placeTypeFilters(category).find(({ id }) => id === type_filter)?.label;
  const result_label = type_label ?? category_label;
  const heading = scoped_city ? `${result_label} near ${scoped_label}` : result_label;
  const quick_sights = category === 'sight' && Boolean(scoped_city && onQuickAdd);
  const schedule_stay =
    category === 'stay' && scoped_city && onScheduleStay
      ? (place: StopSearchResult, origin: HTMLElement) => {
          if (map_open) rememberSelection(place.id);
          onScheduleStay(place, origin, { name: scoped_city, id: scoped_id, label: scoped_label });
        }
      : undefined;

  useLayoutEffect(() => {
    const strip = category_strip.current;
    const selected = strip?.querySelector('button[aria-pressed="true"]');
    if (!active || !strip || !selected) return;
    const observer = new ResizeObserver(() => {
      const bounds = strip.getBoundingClientRect();
      const tab = selected.getBoundingClientRect();
      if (tab.left < bounds.left) strip.scrollBy({ left: tab.left - bounds.left });
      else if (tab.right > bounds.right) strip.scrollBy({ left: tab.right - bounds.right });
    });
    observer.observe(strip);
    observer.observe(selected);
    return () => observer.disconnect();
  }, [active, category]);

  useLayoutEffect(() => {
    if (!map_open && return_to_map_button.current) {
      (map_button.current ?? results_heading.current)?.focus({ preventScroll: true });
      return_to_map_button.current = false;
    }
    if (!adding_id && return_focus.current) {
      return_focus.current.focus({ preventScroll: true });
      return_focus.current = null;
    }
  });

  async function addSight(place: StopSearchResult, row: HTMLElement, button: HTMLElement) {
    if (!onQuickAdd || saving.current) return;
    if (map_open) rememberSelection(place.id);
    saving.current = true;
    setAddingId(place.id);
    setSaveError(undefined);
    try {
      await onQuickAdd(place, scoped_city, scoped_id);
      return_focus.current = row;
    } catch (reason) {
      setSaveError({
        id: place.id,
        message: reason instanceof Error ? reason.message : 'Could not add this sight. Try again.',
      });
      return_focus.current = button;
    } finally {
      saving.current = false;
      setAddingId(null);
    }
  }

  function cityLabel(index: number) {
    return searchCityLabel(route_cities, index);
  }

  function changeSearch(text: string, submitted: string | null, key = scope_key) {
    setExpanded(null);
    setSearches((previous) => ({
      ...previous,
      [key]: { ...previous[key], text, submitted, type_filter },
    }));
  }

  function rememberSelection(id: string) {
    setMapSelections((previous) =>
      previous[selection_key] === id ? previous : { ...previous, [selection_key]: id },
    );
  }

  function searchOtherCity(index: number, term: string) {
    changeSearch(term, term, searchKey(category, index, cities[index]));
    setChosenCity(index);
  }

  function emptyResultsMessage() {
    if (filtering)
      return planned.length
        ? 'No other nearby matches. Tap Search to look farther afield.'
        : 'No nearby matches. Tap Search to look farther afield.';
    if (planned.length) return 'No additional matches from place search.';
    if (other_cities.length) return `No matches in ${scoped_label}.`;
    if (type_filter)
      return named_term
        ? 'No matches in this type. Try another type or enter the stop manually.'
        : 'No nearby places of this type. Choose another type or search by name.';
    return named_term
      ? 'No matches. Try another name or enter the stop manually.'
      : 'No nearby places found. Search by name or enter the stop manually.';
  }

  function tryAgain() {
    setExpanded(null);
    suggestions.retry();
  }

  function submitSearch() {
    if (!can_search || composing) return;
    results_heading.current?.focus({ preventScroll: true });
    const term = query.trim();
    if (submitted_query === term) {
      if (!loading) tryAgain();
    } else {
      changeSearch(query, term);
    }
  }

  function chooseResult(place: StopSearchResult, origin: HTMLElement) {
    if (map_open) rememberSelection(place.id);
    setSaveError(undefined);
    setExpanded(null);
    onPick(place, origin, scoped_city, scoped_id);
  }

  const type_control = is_browsable && scoped_city && (
    <PlaceTypeFilterButton
      category={category}
      value={type_filter}
      disabled={adding_id !== null}
      onSelect={(value) => {
        setExpanded(null);
        setSaveError(undefined);
        setSearches((previous) => ({
          ...previous,
          [scope_key]: { ...(previous[scope_key] ?? empty_search), type_filter: value },
        }));
      }}
    />
  );

  const result_controls = (
    <>
      {can_compare && scoped_city && (
        <PlaceSortButton
          value={sort}
          disabled={adding_id !== null}
          onSelect={(value) => {
            if (map_open && current_place) rememberSelection(current_place.place.id);
            setSearches((previous) => ({
              ...previous,
              [scope_key]: { ...(previous[scope_key] ?? empty_search), sort: value },
            }));
          }}
        />
      )}
      {type_control}
    </>
  );

  const city_choices = (
    <div className="stop-picker-cities" role="group" aria-label="Search city">
      {options.length === 0 || (options.length === 1 && city_index !== undefined) ? (
        <span className="stop-picker-single-city">
          <Icon name="pin" size={18} /> {city}
        </span>
      ) : (
        options.map((index, order) => (
          <Fragment key={index}>
            {order > 0 && day_indices.length > 0 && <Icon name="arrow" size={16} />}
            <button
              type="button"
              aria-label={`Search in ${cityLabel(index)}`}
              aria-pressed={city_index === index}
              onClick={() => {
                setExpanded(null);
                setSaveError(undefined);
                setChosenCity(index);
              }}
            >
              <Icon name={city_index === index ? 'check' : 'pin'} size={16} /> {cityLabel(index)}
            </button>
          </Fragment>
        ))
      )}
    </div>
  );

  return (
    <fieldset className="stop-picker" aria-label="Place picker" disabled={adding_id !== null}>
      <div className="stop-picker-scroll">
        <div className="stop-picker-controls">
          {isCalendarDate(day) && (
            <p className="stop-picker-date">
              <Icon name="book" size={15} />
              {trip.start_date && (
                <>
                  <strong>{itineraryDayLabel(day, day, trip)}</strong>
                  <span aria-hidden="true">·</span>
                </>
              )}
              <time dateTime={day}>{date_format.format(new Date(day + 'T00:00:00Z'))}</time>
            </p>
          )}
          {!airports &&
            (options.length ? (
              city_choices
            ) : (
              <label className="stop-picker-city-input">
                Search city
                <input
                  value={custom_city}
                  maxLength={text_limits.city_name}
                  placeholder="City name"
                  onChange={(event) => setCustomCity(event.target.value)}
                />
              </label>
            ))}
          <div
            ref={category_strip}
            className="stop-picker-categories"
            role="group"
            aria-label="Place categories"
          >
            {categories.map(([value, label, icon]) => (
              <button
                type="button"
                key={value}
                aria-pressed={value === category}
                onClick={() => {
                  if (value === category) return;
                  setExpanded(null);
                  setCategory(value);
                  onCategoryChange?.(value);
                }}
              >
                <Icon name={icon} size={20} />
                {label}
              </button>
            ))}
          </div>
          <div role="search" className="stop-picker-search">
            <div className="search-box">
              <Icon name="search" size={18} />
              <input
                ref={input}
                type="search"
                aria-label={airports ? 'Search airports' : 'Search places'}
                aria-describedby={heading_id}
                placeholder={
                  airports
                    ? 'Airport name, city or code'
                    : `Search ${category_label.toLowerCase()} by name`
                }
                enterKeyHint="search"
                autoComplete="off"
                maxLength={text_limits.stop_title}
                value={query}
                onCompositionStart={() => setComposing(true)}
                onCompositionEnd={() => setComposing(false)}
                onBlur={() => setComposing(false)}
                onChange={(event) => {
                  const value = event.target.value;
                  changeSearch(value, value.trim() ? null : '');
                }}
                onKeyDown={(event) => {
                  if (confirmsInput(event.nativeEvent)) {
                    event.preventDefault();
                    submitSearch();
                  }
                }}
              />
              {query && (
                <button
                  className="stop-picker-clear"
                  type="button"
                  aria-label="Clear search"
                  onClick={() => {
                    changeSearch('', '');
                    input.current?.focus({ preventScroll: true });
                  }}
                >
                  <Icon name="close" size={16} />
                </button>
              )}
            </div>
            {query && (
              <button
                className="primary"
                type="button"
                disabled={!can_search || (loading && submitted_query !== null)}
                onClick={submitSearch}
              >
                Search
              </button>
            )}
          </div>
        </div>
        <section className="stop-picker-content" aria-label="Place suggestions">
          <div className="stop-results-heading">
            <h3 id={heading_id} ref={results_heading} tabIndex={-1}>
              {heading}
            </h3>
            <div className="stop-results-tools">
              {result_controls}
              {is_browsable && Boolean(places?.length) && (
                <button
                  ref={map_button}
                  className="stop-results-map-action"
                  type="button"
                  aria-label="Map of results"
                  aria-haspopup="dialog"
                  onClick={() => {
                    setExpanded(null);
                    if (current_place) rememberSelection(current_place.place.id);
                    setMapOpen(true);
                  }}
                >
                  <Icon name="map" size={18} /> <span>Map</span>
                </button>
              )}
            </div>
          </div>
          {onEditPlanned && planned.length > 0 && (
            <>
              <h4 className="stop-picker-section-title">On this day</h4>
              <ul className="stop-picker-results" aria-label="On this day">
                {planned.map((stop) => (
                  <PlannedSearchResult key={stop.id} stop={stop} onEdit={onEditPlanned} />
                ))}
              </ul>
              <h4 className="stop-picker-section-title">Place search</h4>
            </>
          )}
          <div role="status" aria-atomic="true">
            {loading && (
              <p className={places?.length || planned.length ? 'sr-only' : 'stop-picker-status'}>
                {suggestions.searching_name ? 'Searching…' : 'Finding nearby places…'}
              </p>
            )}
            {places &&
              (places.length ? (
                <p className="sr-only">
                  {places.length} {places.length === 1 ? 'place' : 'places'} found.
                  {filtering && ' Matching nearby places.'}
                </p>
              ) : (
                !loading && !error && <p className="stop-picker-status">{emptyResultsMessage()}</p>
              ))}
          </div>
          {error && (
            <div className="stop-picker-error">
              <p role="alert">{error}</p>
              <button type="button" className="secondary" onClick={tryAgain}>
                Try again
              </button>
            </div>
          )}
          {!suggestions.has_request && (
            <p className="stop-picker-status">
              {!airports && !city
                ? options.length
                  ? 'Choose a city to find places.'
                  : 'Enter a city and search by place name.'
                : airports
                  ? 'Search by airport name, city or code.'
                  : 'Enter a place name and tap Search.'}
            </p>
          )}
          {results && results.length > 0 && (
            <ul className="stop-picker-results" aria-label="Place results">
              {results.map((result) => {
                const { place } = result;
                return (
                  <StopPlaceResult
                    key={place.id}
                    result={result}
                    expanded={expanded === place.id}
                    onExpand={(open) => setExpanded(open ? place.id : null)}
                    onEditPlanned={onEditPlanned}
                    adding={adding_id === place.id}
                    error={save_error?.id === place.id ? save_error.message : undefined}
                    onQuickAdd={
                      quick_sights && place.kind === 'sight'
                        ? (row, button) => void addSight(place, row, button)
                        : undefined
                    }
                    onScheduleStay={
                      schedule_stay && place.kind === 'stay'
                        ? (origin) => schedule_stay(place, origin)
                        : undefined
                    }
                    onPick={(origin) => chooseResult(place, origin)}
                  />
                );
              })}
            </ul>
          )}
          {named_term &&
            other_cities.map((index) => (
              <button
                key={index}
                type="button"
                className="secondary stop-picker-other-city"
                aria-label={`Search for “${named_term}” in ${cityLabel(index)}`}
                onClick={() => searchOtherCity(index, named_term)}
              >
                <Icon name="search" size={16} /> Search in {cityLabel(index)}
              </button>
            ))}
          {airports ? (
            <p className="stop-picker-credit">
              <a href="https://ourairports.com/data/" target="_blank" rel="noopener noreferrer">
                OurAirports
              </a>
              {' · Available offline'}
            </p>
          ) : (
            (places || error) && (
              <p className="stop-picker-credit">
                <a
                  href={
                    lookup.attribution === 'Geoapify'
                      ? 'https://www.geoapify.com/'
                      : 'https://photon.komoot.io/'
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {lookup.attribution}
                </a>
                {' · © '}
                <a
                  href="https://www.openstreetmap.org/copyright"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  OpenStreetMap contributors
                </a>
              </p>
            )
          )}
        </section>
      </div>
      <footer className="stop-picker-footer">
        <p role="status" aria-atomic="true" className="stop-picker-confirmation">
          {saved_message && (
            <>
              <Icon name="check" size={15} />
              <span>{saved_message}</span>
            </>
          )}
        </p>
        <button
          type="button"
          className="secondary"
          onClick={(event) => {
            setExpanded(null);
            setSaveError(undefined);
            onManual(
              query.trim(),
              category === 'airport' ? 'transport' : category === 'all' ? 'sight' : category,
              event.currentTarget,
              scoped_city,
              scoped_id,
            );
          }}
        >
          <Icon name="edit" size={17} /> Enter manually
        </button>
      </footer>
      {map_open && (
        <PlaceResultsSheet
          active={active}
          native={native}
          heading={heading}
          day_label={
            trip.start_date
              ? itineraryDayLabel(day, day, trip)
              : date_format.format(new Date(day + 'T00:00:00Z'))
          }
          route={route}
          stays={stays}
          cities={city_choices}
          result_controls={result_controls}
          results={results ?? []}
          selected_id={current_place?.place.id}
          onSelect={rememberSelection}
          search_status={loading ? 'Finding places…' : emptyResultsMessage()}
          search_error={error ?? ''}
          onRetry={tryAgain}
          saving={adding_id !== null}
          saved_message={saved_message}
          saved_stop_id={saved_stop_id}
          save_error={save_error}
          onPick={chooseResult}
          onQuickAdd={quick_sights ? addSight : undefined}
          onScheduleStay={schedule_stay}
          onEditPlanned={onEditPlanned}
          onClose={() => {
            return_to_map_button.current = true;
            setMapOpen(false);
          }}
        />
      )}
    </fieldset>
  );
}
