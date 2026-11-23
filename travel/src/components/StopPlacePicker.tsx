import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { cityIndicesOnDay } from '../lib/city-days';
import { isCalendarDate, itineraryDayLabel } from '../lib/dates';
import { distanceKm } from '../lib/distance';
import { text_limits } from '../lib/model';
import type { StopLookup, StopSearchRequest, StopSearchResult } from '../lib/stop-lookup';
import type { PlannedStop, StopKind, Trip } from '../lib/types';
import { Icon } from './Icon';
import '../stop-place-picker.css';

const categories = [
  ['sight', 'Sights', 'landmark'],
  ['stay', 'Hotels', 'bed'],
  ['food', 'Food', 'food'],
  ['airport', 'Airports', 'plane'],
  ['all', 'Places', 'compass'],
] as const;

const place_icons = {
  sight: 'landmark',
  stay: 'bed',
  food: 'food',
  transport: 'route',
  other: 'pin',
} as const;

const date_format = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

type SearchState =
  | { request: StopSearchRequest; places: StopSearchResult[] }
  | { request: StopSearchRequest; error: string };

export function StopPlacePicker({
  trip,
  day,
  lookup,
  initial_category = 'sight',
  day_stops = [],
  onPick,
  onManual,
}: {
  trip: Trip;
  day: string;
  lookup: StopLookup;
  initial_category?: StopSearchRequest['category'];
  day_stops?: PlannedStop[];
  onPick(place: StopSearchResult): void;
  onManual(name: string, kind: StopKind): void;
}) {
  const cities = trip.cities ?? [];
  const day_indices = cityIndicesOnDay(trip, day);
  const options = day_indices.length ? day_indices : cities.map((_, index) => index);
  const [category, setCategory] = useState(initial_category);
  const [chosen_city, setChosenCity] = useState<number>();
  const [custom_city, setCustomCity] = useState('');
  const [query, setQuery] = useState('');
  // An empty submitted query browses the category. A null one waits for the traveler to submit.
  const [submitted_query, setSubmittedQuery] = useState<string | null>('');
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<SearchState>();
  const browse_cache = useRef(new Map<string, StopSearchResult[]>());
  const input = useRef<HTMLInputElement>(null);
  const airports = category === 'airport';
  const is_browsable = category === 'sight' || category === 'stay';
  const default_city = category === 'stay' ? day_indices.at(-1) : day_indices[0];
  const city_index = chosen_city ?? default_city;
  const city = city_index === undefined ? custom_city.trim() : cities[city_index];
  const location = city_index === undefined ? null : trip.city_locations?.[city_index];
  const can_search = Boolean(query.trim() && (airports || city));
  const can_browse = is_browsable && city_index !== undefined;
  const request = useMemo<StopSearchRequest | null>(() => {
    if (submitted_query === null || (!airports && !city) || (!submitted_query && !can_browse))
      return null;
    return {
      category,
      city: airports ? '' : city,
      location: airports ? null : location,
      query: submitted_query,
    };
  }, [airports, can_browse, category, city, location, submitted_query]);
  const current = state?.request === request ? state : undefined;
  const loading = Boolean(request && !current);
  const places = current && 'places' in current ? current.places : undefined;
  const error = current && 'error' in current ? current.error : '';
  const category_label = categories.find(([key]) => key === category)![1];
  const heading = submitted_query
    ? `Results for “${submitted_query}”`
    : !airports && city
      ? `${category_label} near ${city}`
      : category_label;

  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    const browse_key = request.query ? '' : JSON.stringify(request);
    async function search(active: StopSearchRequest) {
      await Promise.resolve();
      if (controller.signal.aborted) return;
      const cached = browse_key && browse_cache.current.get(browse_key);
      if (cached) {
        setState({ request: active, places: cached });
        return;
      }
      try {
        if (active.category !== 'airport' && navigator.onLine === false)
          throw new Error('You’re offline. Search airports or enter a stop manually.');
        const results = await lookup.search(active, controller.signal);
        if (controller.signal.aborted) return;
        if (browse_key) browse_cache.current.set(browse_key, results);
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

  function onThisDay(place: StopSearchResult) {
    return day_stops.some((stop) => {
      if (stop.directory_ref)
        return stop.directory_ref.provider === place.source && stop.directory_ref.id === place.id;
      return (
        stop.position &&
        stop.title.localeCompare(place.title, undefined, { sensitivity: 'accent' }) === 0 &&
        distanceKm(stop.position, place.position) <= 0.25
      );
    });
  }

  function clearSearch() {
    setQuery('');
    setSubmittedQuery('');
  }

  function tryAgain() {
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
      setSubmittedQuery(term);
    }
  }

  return (
    <div className="stop-picker">
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
              <div className="stop-picker-cities" role="group" aria-label="Search city">
                {options.length === 1 && city_index !== undefined ? (
                  <span className="stop-picker-single-city">
                    <Icon name="pin" size={18} />
                    {city}
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
                          if (city_index !== index) clearSearch();
                          setChosenCity(index);
                        }}
                      >
                        <Icon name={city_index === index ? 'check' : 'pin'} size={16} />
                        {cityLabel(index)}
                      </button>
                    </Fragment>
                  ))
                )}
              </div>
            ) : (
              <label className="stop-picker-city-input">
                Search city
                <input
                  value={custom_city}
                  maxLength={text_limits.city_name}
                  placeholder="City name"
                  onChange={(event) => {
                    setCustomCity(event.target.value);
                    setSubmittedQuery(query.trim() ? null : '');
                  }}
                />
              </label>
            ))}
          <div className="stop-picker-categories" role="group" aria-label="Place categories">
            {categories.map(([value, label, icon]) => (
              <button
                type="button"
                key={value}
                aria-pressed={value === category}
                onClick={() => {
                  if (category !== value) {
                    clearSearch();
                    setCategory(value);
                  }
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
                  setQuery(value);
                  setSubmittedQuery(value.trim() ? null : '');
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    !event.nativeEvent.isComposing &&
                    event.nativeEvent.keyCode !== 229
                  ) {
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
                  onClick={clearSearch}
                >
                  <Icon name="close" size={16} />
                </button>
              )}
            </div>
            {query && (
              <button
                className="primary"
                type="button"
                disabled={!can_search || loading}
                onClick={submitSearch}
              >
                Search
              </button>
            )}
          </div>
        </div>
        <section className="stop-picker-content" aria-label="Place suggestions">
          <h3>{heading}</h3>
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
                </p>
              ) : (
                <p className="stop-picker-status">
                  {submitted_query
                    ? 'No matches. Try another name or enter the stop manually.'
                    : 'No nearby places found. Search by name or enter the stop manually.'}
                </p>
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
                <li key={place.id}>
                  <button type="button" onClick={() => onPick(place)}>
                    <span className="stop-picker-pin" data-kind={place.kind}>
                      <Icon name={airports ? 'plane' : place_icons[place.kind]} size={21} />
                    </span>
                    <span className="stop-picker-label">
                      <strong>{place.title}</strong>
                      {place.subtitle && <small>{place.subtitle}</small>}
                      {onThisDay(place) && (
                        <span className="stop-picker-planned">
                          <Icon name="check" size={12} /> On this day
                        </span>
                      )}
                    </span>
                    <Icon name="next" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
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
        <button
          type="button"
          className="secondary"
          onClick={() =>
            onManual(
              query.trim(),
              category === 'airport' ? 'transport' : category === 'all' ? 'sight' : category,
            )
          }
        >
          <Icon name="edit" size={17} /> Enter manually
        </button>
      </footer>
    </div>
  );
}
