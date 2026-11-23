import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { confirmsInput } from '../lib/keyboard';
import {
  cityKey,
  directoryCityOptions,
  more_cities,
  sameTripCity,
  searchFeaturedCities,
  suggested_cities,
  tripCityLocation,
  type CityOption,
} from '../lib/cities';
import { text_limits } from '../lib/model';
import { getDirectoryCitiesById, searchDirectoryCities } from '../lib/offline-directory';
import type { TripCityLocation } from '../lib/types';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import '../city-picker.css';

interface CityPickerProps {
  title: string;
  excluded_cities?: { name: string; location?: TripCityLocation | null }[];
  onSelect(city: string, location?: TripCityLocation): void | Promise<void>;
  onDismiss(): void;
}

export function CityPicker({ title, excluded_cities = [], onSelect, onDismiss }: CityPickerProps) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ city: CityOption; message: string } | null>(null);
  const [search, setSearch] = useState<{
    query: string;
    matches: CityOption[];
    custom_name: string;
    failed: boolean;
  } | null>(null);
  const selecting = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  const searching = Boolean(cityKey(query));
  const result = searching && search?.query === query ? search : null;

  useEffect(() => {
    if (!searching) return;
    let active = true;
    const fallback = searchFeaturedCities(query);
    void searchDirectoryCities(query).then(
      (records) => {
        if (!active) return;
        const matches = directoryCityOptions(records);
        const ids = new Set(matches.map((place) => place.id));
        const missing = fallback.matches.filter((place) => !ids.has(place.id));
        setSearch({
          query,
          matches: [...matches, ...missing],
          custom_name: records.some((city) => city.exact_match) ? '' : fallback.custom_name,
          failed: false,
        });
      },
      () => {
        if (active) setSearch({ query, ...fallback, failed: true });
      },
    );
    return () => {
      active = false;
    };
  }, [query, searching]);

  useLayoutEffect(() => {
    list.current?.scrollTo(0, 0);
  }, [query]);

  async function selectCity(city: CityOption) {
    if (selecting.current) return;
    selecting.current = true;
    setBusy(true);
    setFailure(null);
    try {
      let location = city.location;
      if (city.id && !location) {
        // Featured rows are available even if the bundled worldwide directory cannot be opened.
        const [record] = await getDirectoryCitiesById([city.id]).catch(() => []);
        if (record) location = tripCityLocation(record);
      }
      const namesake =
        location &&
        excluded_cities.some(
          (excluded) =>
            excluded.location &&
            excluded.location.id !== city.id &&
            cityKey(excluded.name) === cityKey(city.name),
        );
      const qualified = `${city.name}, ${city.region}`;
      await onSelect(
        namesake && qualified.length <= text_limits.city_name ? qualified : city.name,
        location,
      );
    } catch (reason) {
      setFailure({
        city,
        message: reason instanceof Error ? reason.message : 'Could not save the trip.',
      });
    } finally {
      selecting.current = false;
      setBusy(false);
    }
  }

  function option(city: CityOption, custom = false) {
    const { id, name, region } = city;
    const accessible_name = custom ? `Use ${name}` : `${name}, ${region}`;
    const unavailable = excluded_cities.some((excluded) =>
      sameTripCity(excluded.name, excluded.location, name, id ? { id } : undefined),
    );
    return (
      <li key={id ?? `custom-${name}`}>
        <button
          type="button"
          className="city-option"
          aria-label={unavailable ? `${accessible_name}, already selected` : accessible_name}
          disabled={unavailable || busy}
          onClick={() => void selectCity(city)}
        >
          {custom && <Icon name="plus" size={19} />}
          <span className="city-option-label">
            <strong>{name}</strong>
            <small>{unavailable ? 'Already selected' : region}</small>
          </span>
          <Icon name={unavailable ? 'check' : 'next'} size={15} />
        </button>
      </li>
    );
  }

  return (
    <Dialog title={title} full_screen dismiss_disabled={busy} onDismiss={onDismiss}>
      <div className="city-picker">
        <div role="search" className="city-search">
          <label className="search-box">
            <Icon name="search" size={19} />
            <input
              type="search"
              aria-label="Search cities"
              placeholder="Search by city or country"
              autoComplete="off"
              enterKeyHint="search"
              maxLength={text_limits.city_name}
              value={query}
              disabled={busy}
              onChange={(event) => {
                setQuery(event.target.value);
                setFailure(null);
              }}
              onKeyDown={(event) => {
                if (confirmsInput(event.nativeEvent)) {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
            />
          </label>
        </div>
        {busy && (
          <p className="city-save-status" role="status">
            Saving trip…
          </p>
        )}
        {failure && (
          <div className="city-save-error" role="alert">
            <p>{failure.message}</p>
            <button className="secondary" onClick={() => void selectCity(failure.city)}>
              Try again
            </button>
          </div>
        )}
        <div className="city-directory" ref={list}>
          {searching ? (
            <section>
              <h3 aria-live="polite">
                {!result
                  ? 'Searching…'
                  : result.matches.length
                    ? 'Search results'
                    : 'No matching cities'}
              </h3>
              {result?.failed && (
                <p className="city-directory-status" role="status">
                  The full city directory couldn’t be opened. Choose a featured city or use the name
                  you entered.
                </p>
              )}
              <ul className="city-list">
                {result?.matches.map((city) => option(city))}
                {result?.custom_name &&
                  option({ name: result.custom_name, region: 'Use this city name' }, true)}
              </ul>
            </section>
          ) : (
            <>
              <section>
                <h3>Suggested cities</h3>
                <ul className="city-suggestions">{suggested_cities.map((city) => option(city))}</ul>
              </section>
              <section>
                <h3>More cities</h3>
                <ul className="city-list">{more_cities.map((city) => option(city))}</ul>
              </section>
            </>
          )}
          <p className="city-directory-credit">
            City data from{' '}
            <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">
              GeoNames
            </a>
          </p>
        </div>
      </div>
    </Dialog>
  );
}
