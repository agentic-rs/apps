import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { confirmsInput } from '../lib/keyboard';
import { cityIndicesOnDay } from '../lib/city-days';
import type { ContinuingStay } from '../lib/hotel-stays';
import { placeTypeFilters, type PlaceTypeFilter } from '../lib/place-types';
import { isCalendarDate, itineraryDayLabel } from '../lib/dates';
import { text_limits } from '../lib/model';
import {
  matchesPlannedPlace,
  searchPlannedStops,
  type SearchCity,
} from '../lib/planned-stop-search';
import {
  filterNearbyPlaces,
  groupPlacesForCity,
  resolveSearchCity,
  type StopLookup,
  type StopSearchRequest,
  type StopSearchResult,
} from '../lib/stop-lookup';
import type { PlannedStop, StopKind, Trip } from '../lib/types';
import { Icon } from './Icon';
import { PlannedSearchResult, StopPlaceResult } from './StopPlaceResult';
import { PlaceResultsSheet } from './PlaceResultsSheet';
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

type SearchState =
  | { request: StopSearchRequest; places: StopSearchResult[] }
  | { request: StopSearchRequest; error: string };

type SearchInput = { text: string; submitted: string | null; type_filter?: PlaceTypeFilter };
const empty_search: SearchInput = { text: '', submitted: '' };

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
  onCategoryChange,
  onEditPlanned,
  onQuickAdd,
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
  onCategoryChange?(category: StopSearchRequest['category']): void;
  onEditPlanned?(stop: PlannedStop): void;
  onQuickAdd?(place: StopSearchResult, city?: string, city_id?: string): Promise<void>;
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
  const route_cities = useMemo<SearchCity[]>(
    () =>
      options.map((index) => ({
        index,
        name: trip.cities![index],
        location: trip.city_locations?.[index],
      })),
    [options, trip],
  );
  const [resolved, setResolved] = useState<{ route: SearchCity[]; cities: SearchCity[] }>();
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
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<SearchState>();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [map_open, setMapOpen] = useState(false);
  const map_button = useRef<HTMLButtonElement>(null);
  const results_heading = useRef<HTMLHeadingElement>(null);
  const return_to_map_button = useRef(false);
  const [adding_id, setAddingId] = useState<string | null>(null);
  const [save_error, setSaveError] = useState<{ id: string; message: string }>();
  const saving = useRef(false);
  const return_focus = useRef<HTMLElement | null>(null);
  const input = useRef<HTMLInputElement>(null);
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
  useEffect(() => {
    if (!needs_centers || resolved?.route === route_cities) return;
    let active = true;
    void Promise.all(
      route_cities.map(async (city) => {
        if (city.location) return city;
        const location = await resolveSearchCity(city.name).catch(() => undefined);
        return { ...city, location };
      }),
    ).then((cities) => {
      if (active) setResolved({ route: route_cities, cities });
    });
    return () => {
      active = false;
    };
  }, [needs_centers, route_cities, resolved]);
  const can_search = Boolean(query.trim() && (airports || city));
  const can_browse = is_browsable && city_index !== undefined;
  // While composing, keep the nearby request alive and match its rows on device.
  const search_term = submitted_query ?? (can_browse ? '' : null);
  // Saving reparses the journal and its city objects. Keep the current results
  // mounted when the city's actual search parameters are unchanged.
  const request = useMemo<StopSearchRequest | null>(() => {
    if (search_term === null || (!airports && !city) || (!search_term && !can_browse)) return null;
    return {
      category,
      city: airports ? '' : city,
      location: airports ? null : location,
      query: search_term,
      type_filter,
    };
  }, [
    airports,
    can_browse,
    category,
    city,
    location?.id,
    location?.country_code,
    location?.latitude,
    location?.longitude,
    search_term,
    type_filter,
  ]);
  const current = state?.request === request ? state : undefined;
  const loading = Boolean(request && !current);
  const response_places = current && 'places' in current ? current.places : undefined;
  const scoped =
    response_places && !airports && city_index !== undefined
      ? groupPlacesForCity(response_places, trip, options, city_index)
      : undefined;
  const results = scoped?.places ?? response_places;
  const other_cities = submitted_query ? (scoped?.other_cities ?? []) : [];
  const filtering = submitted_query === null && can_browse;
  const places = results && filtering ? filterNearbyPlaces(results, query) : results;
  const planned =
    onEditPlanned && city && (query.trim() || type_filter) && !airports
      ? searchPlannedStops(
          day_stops,
          query,
          category,
          resolved?.route === route_cities ? resolved.cities : route_cities,
          city_index,
          day,
          custom_city,
          type_filter,
        ).filter((stop) => !places?.some((place) => matchesPlannedPlace(stop, place)))
      : [];
  const error = current && 'error' in current ? current.error : '';
  const category_label = categories.find(([key]) => key === category)![1];
  const scoped_label = city_index === undefined ? city : cityLabel(city_index);
  const type_label =
    type_filter && placeTypeFilters(category).find(({ id }) => id === type_filter)?.label;
  const result_label = type_label ?? category_label;
  const heading = scoped_city ? `${result_label} near ${scoped_label}` : result_label;
  const quick_sights = Boolean(
    onQuickAdd && can_browse && !submitted_query && category === 'sight',
  );

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

  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    async function search(active: StopSearchRequest) {
      await Promise.resolve();
      if (controller.signal.aborted) return;
      try {
        const results = await lookup.search(active, controller.signal);
        if (controller.signal.aborted) return;
        setState({ request: active, places: results });
      } catch (reason) {
        if (!controller.signal.aborted)
          setState({
            request: active,
            error: reason instanceof Error ? reason.message : 'Search failed. Please try again.',
          });
      }
    }
    void search(request);
    return () => controller.abort();
  }, [lookup, request, retry]);

  function cityLabel(index: number) {
    const name = cities[index];
    if (!options.some((other) => other !== index && cities[other] === name)) return name;
    const country = trip.city_locations?.[index]?.country_code;
    return [name, country, `City ${index + 1}`].filter(Boolean).join(' · ');
  }

  function changeSearch(text: string, submitted: string | null, key = scope_key) {
    setExpanded(null);
    setSearches((previous) => ({ ...previous, [key]: { text, submitted, type_filter } }));
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
      return submitted_query
        ? 'No matches in this type. Try another type or enter the stop manually.'
        : 'No nearby places of this type. Choose another type or search by name.';
    return submitted_query
      ? 'No matches. Try another name or enter the stop manually.'
      : 'No nearby places found. Search by name or enter the stop manually.';
  }

  function tryAgain() {
    setExpanded(null);
    setState(undefined);
    setRetry((count) => count + 1);
  }

  function submitSearch() {
    if (!can_search) return;
    input.current?.blur();
    const term = query.trim();
    if (submitted_query === term) {
      if (!loading) tryAgain();
    } else {
      changeSearch(query, term);
    }
  }

  function chooseResult(place: StopSearchResult, origin: HTMLElement) {
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
                placeholder={
                  airports
                    ? 'Airport name, city or code'
                    : `Search ${category_label.toLowerCase()} by name`
                }
                enterKeyHint="search"
                autoComplete="off"
                maxLength={text_limits.stop_title}
                value={query}
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
            <h3 ref={results_heading} tabIndex={-1}>
              {heading}
            </h3>
            <div className="stop-results-tools">
              {type_control}
              {is_browsable && Boolean(places?.length) && (
                <button
                  ref={map_button}
                  className="stop-results-map-action"
                  type="button"
                  aria-label="Map of results"
                  aria-haspopup="dialog"
                  onClick={() => {
                    setExpanded(null);
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
              <p className="stop-picker-status">
                {submitted_query ? 'Searching…' : 'Finding nearby places…'}
              </p>
            )}
            {places &&
              (places.length ? (
                <p className="sr-only">
                  {places.length} {places.length === 1 ? 'place' : 'places'} found.
                  {filtering && ' Matching nearby places.'}
                </p>
              ) : (
                <p className="stop-picker-status">{emptyResultsMessage()}</p>
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
          {!request && (
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
          {places && places.length > 0 && (
            <ul className="stop-picker-results" aria-label="Place results">
              {places.map((place) => (
                <StopPlaceResult
                  key={place.id}
                  place={place}
                  day_stops={day_stops}
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
                  onPick={(origin) => chooseResult(place, origin)}
                />
              ))}
            </ul>
          )}
          {submitted_query &&
            other_cities.map((index) => (
              <button
                key={index}
                type="button"
                className="secondary stop-picker-other-city"
                aria-label={`Search for “${submitted_query}” in ${cityLabel(index)}`}
                onClick={() => searchOtherCity(index, submitted_query)}
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
          day_stops={day_stops}
          route={route}
          stays={stays}
          cities={city_choices}
          type_control={type_control}
          places={places ?? []}
          search_status={loading ? 'Finding places…' : emptyResultsMessage()}
          search_error={error}
          onRetry={tryAgain}
          saving={adding_id !== null}
          saved_message={saved_message}
          save_error={save_error}
          onPick={chooseResult}
          onQuickAdd={quick_sights ? addSight : undefined}
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
