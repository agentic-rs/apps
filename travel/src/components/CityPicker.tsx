import { useLayoutEffect, useRef, useState } from 'react';
import {
  cityKey,
  more_cities,
  searchCities,
  suggested_cities,
  type CatalogCity,
} from '../lib/cities';
import { text_limits } from '../lib/model';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import '../city-picker.css';

interface CityPickerProps {
  title: string;
  excluded_cities?: string[];
  onSelect(city: string): void;
  onDismiss(): void;
}

export function CityPicker({ title, excluded_cities = [], onSelect, onDismiss }: CityPickerProps) {
  const [query, setQuery] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const { matches, custom_name } = searchCities(query);
  const searching = Boolean(cityKey(query));
  const excluded = new Set(excluded_cities.map(cityKey));

  useLayoutEffect(() => {
    list.current?.scrollTo(0, 0);
  }, [query]);

  function option(name: string, region: string, accessible_name: string, custom = false) {
    const unavailable = excluded.has(cityKey(name));
    return (
      <li key={name}>
        <button
          type="button"
          className="city-option"
          aria-label={unavailable ? `${accessible_name}, already selected` : accessible_name}
          disabled={unavailable}
          onClick={() => onSelect(name)}
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

  function cityOption({ name, region }: CatalogCity) {
    return option(name, region, `${name}, ${region}`);
  }

  return (
    <Dialog title={title} full_screen onDismiss={onDismiss}>
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
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
            />
          </label>
        </div>
        <div className="city-directory" ref={list}>
          {searching ? (
            <section>
              <h3 aria-live="polite">{matches.length ? 'Search results' : 'No matching cities'}</h3>
              <ul className="city-list">
                {matches.map(cityOption)}
                {custom_name &&
                  option(custom_name, 'Use this city name', `Use ${custom_name}`, true)}
              </ul>
            </section>
          ) : (
            <>
              <section>
                <h3>Suggested cities</h3>
                <ul className="city-suggestions">{suggested_cities.map(cityOption)}</ul>
              </section>
              <section>
                <h3>More cities</h3>
                <ul className="city-list">{more_cities.map(cityOption)}</ul>
              </section>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
