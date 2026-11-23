import { useEffect, useRef, useState } from 'react';
import { cityIndicesOnDay } from '../lib/city-days';
import { isCalendarDate } from '../lib/dates';
import { text_limits } from '../lib/model';
import type { StopLookup, StopSearchRequest, StopSearchResult } from '../lib/stop-lookup';
import type { StopKind, Trip } from '../lib/types';
import { Icon } from './Icon';
import '../stop-place-picker.css';

const categories = [
  ['all', 'Places'],
  ['sight', 'Sights'],
  ['food', 'Food'],
  ['stay', 'Hotels'],
  ['airport', 'Airports'],
] as const;

const date_format = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

type SearchState =
  | { phase: 'idle' | 'loading' }
  | { phase: 'results'; places: StopSearchResult[] }
  | { phase: 'error'; message: string };

export function StopPlacePicker({
  trip,
  day,
  lookup,
  onPick,
  onManual,
}: {
  trip: Trip;
  day: string;
  lookup: StopLookup;
  onPick(place: StopSearchResult): void;
  onManual(name: string, kind: StopKind): void;
}) {
  const cities = trip.cities ?? [];
  const day_indices = cityIndicesOnDay(trip, day);
  const options = day_indices.length ? day_indices : cities.map((_, index) => index);
  const name_counts = new Map<string, number>();
  for (const index of options)
    name_counts.set(cities[index], (name_counts.get(cities[index]) ?? 0) + 1);
  const [city_index, setCityIndex] = useState<number | undefined>(day_indices[0]);
  const [custom_city, setCustomCity] = useState('');
  const [category, setCategory] = useState<StopSearchRequest['category']>('all');
  const [query, setQuery] = useState('');
  const [state, setState] = useState<SearchState>({ phase: 'idle' });
  const pending = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const city = city_index === undefined ? custom_city.trim() : cities[city_index];
  const airports = category === 'airport';
  const can_search = Boolean(query.trim() && (airports || city));
  useEffect(() => () => pending.current?.abort(), []);

  function cityLabel(index: number) {
    const name = cities[index];
    if (name_counts.get(name) === 1) return name;
    const country = trip.city_locations?.[index]?.country_code;
    return [name, country, `City ${index + 1}`].filter(Boolean).join(' · ');
  }

  function resetSearch() {
    pending.current?.abort();
    pending.current = null;
    setState({ phase: 'idle' });
  }

  async function search() {
    if (!can_search) return;
    pending.current?.abort();
    const request = new AbortController();
    pending.current = request;
    input.current?.blur();
    if (!airports && navigator.onLine === false) {
      setState({
        phase: 'error',
        message: 'You’re offline. Search airports or enter a stop manually.',
      });
      return;
    }
    setState({ phase: 'loading' });
    try {
      const places = await lookup.search(
        {
          query: query.trim(),
          category,
          city: airports ? '' : city,
          location: airports || city_index === undefined ? null : trip.city_locations?.[city_index],
        },
        request.signal,
      );
      if (!request.signal.aborted) setState({ phase: 'results', places });
    } catch (reason) {
      if (!request.signal.aborted) {
        setState({
          phase: 'error',
          message:
            reason instanceof Error
              ? reason.message
              : 'Search failed. Try again or enter a stop manually.',
        });
      }
    }
  }

  return (
    <div className="stop-picker">
      <div className="stop-picker-scroll">
        {isCalendarDate(day) && (
          <p className="stop-picker-date">
            <Icon name="book" size={15} />
            <time dateTime={day}>{date_format.format(new Date(day + 'T00:00:00Z'))}</time>
          </p>
        )}
        <div className="stop-picker-categories" role="group" aria-label="Place categories">
          {categories.map(([value, label]) => (
            <button
              type="button"
              key={value}
              aria-pressed={value === category}
              onClick={() => {
                if (category !== value) {
                  resetSearch();
                  setCategory(value);
                }
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {!airports &&
          (options.length ? (
            <div className="stop-picker-cities" role="group" aria-label="Search city">
              <Icon name="pin" size={16} />
              {city_index === undefined && <span>Choose city</span>}
              {options.length === 1 && city_index !== undefined ? (
                <strong>{city}</strong>
              ) : (
                options.map((index) => (
                  <button
                    key={index}
                    type="button"
                    aria-label={`Search in ${cityLabel(index)}`}
                    aria-pressed={city_index === index}
                    onClick={() => {
                      if (city_index !== index) {
                        resetSearch();
                        setCityIndex(index);
                      }
                    }}
                  >
                    {cityLabel(index)}
                  </button>
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
                  resetSearch();
                  setCustomCity(event.target.value);
                }}
              />
            </label>
          ))}
        <div role="search" className="stop-picker-search">
          <label className="search-box">
            <Icon name="search" size={18} />
            <input
              ref={input}
              type="search"
              aria-label={airports ? 'Search airports' : 'Search places'}
              placeholder={airports ? 'Airport name, city or code' : 'Place name'}
              enterKeyHint="search"
              autoComplete="off"
              maxLength={text_limits.stop_title}
              value={query}
              onChange={(event) => {
                resetSearch();
                setQuery(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void search();
                }
              }}
            />
          </label>
          <button
            className="primary"
            type="button"
            disabled={!can_search || state.phase === 'loading'}
            onClick={() => void search()}
          >
            Search
          </button>
        </div>
        {state.phase === 'loading' && (
          <p className="stop-picker-status" role="status">
            Searching…
          </p>
        )}
        {state.phase === 'error' && (
          <p className="form-error" role="alert">
            {state.message}
          </p>
        )}
        {state.phase === 'results' &&
          (state.places.length ? (
            <ul className="stop-picker-results" aria-label="Place results">
              {state.places.map((place) => (
                <li key={place.id}>
                  <button type="button" onClick={() => onPick(place)}>
                    <span className="stop-picker-pin">
                      <Icon name={airports ? 'route' : 'pin'} size={19} />
                    </span>
                    <span className="stop-picker-label">
                      <strong>{place.title}</strong>
                      <small>{place.subtitle}</small>
                    </span>
                    <Icon name="next" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="stop-picker-status" role="status">
              No matches. Try another name or enter the stop manually.
            </p>
          ))}
        {airports ? (
          <p className="stop-picker-credit">
            Airport data from{' '}
            <a href="https://ourairports.com/data/" target="_blank" rel="noopener noreferrer">
              OurAirports
            </a>{' '}
            · Available offline
          </p>
        ) : (
          <p className="stop-picker-credit">
            Powered by{' '}
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
        )}
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
