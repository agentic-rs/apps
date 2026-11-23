import { useRef, useState } from 'react';
import { arrivalDateBounds } from '../lib/city-days';
import { formatTripDates, isCalendarDate } from '../lib/dates';
import type { Trip, TripCityLocation } from '../lib/types';
import { CityPicker } from './CityPicker';
import { Dialog } from './Dialog';
import { EditorForm } from './EditorForm';
import { Icon } from './Icon';
import '../trip-form.css';

export function AddTripCity({
  trip,
  day,
  first_open_day,
  onSave,
  onCancel,
}: {
  trip: Trip;
  day: string;
  first_open_day?: string;
  onSave(city: string, arrival_date: string, location?: TripCityLocation): Promise<void>;
  onCancel(): void;
}) {
  const previous_city = trip.cities?.at(-1);
  const { min } = arrivalDateBounds(trip, trip.cities?.length ?? 0);
  const [selected, setSelected] = useState<{ name: string; location?: TripCityLocation } | null>(
    null,
  );
  const [arrival_date, setArrivalDate] = useState(day < min ? min : day);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);

  if (!selected) {
    return (
      <CityPicker
        title={previous_city ? 'Add a city' : 'Choose a city'}
        excluded_cities={
          previous_city ? [{ name: previous_city, location: trip.city_locations?.at(-1) }] : []
        }
        onDismiss={onCancel}
        onSelect={(name, location) => {
          if (!previous_city) return onSave(name, '', location);
          setSelected({ name, location });
        }}
      />
    );
  }

  const { name, location } = selected;
  async function submit() {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      await onSave(name, arrival_date, location);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not add this city.');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog title="Travel day" dismiss_disabled={busy} onDismiss={onCancel}>
      <EditorForm onSave={submit}>
        {(save) => (
          <>
            <fieldset disabled={busy} className="form-body travel-day-body">
              <p className="travel-city-pair" aria-label={`${previous_city} to ${name}`}>
                <span>{previous_city}</span>
                <Icon name="arrow" size={18} />
                <strong>{name}</strong>
              </p>
              <label>
                Travel date
                <input
                  type="date"
                  min={min || undefined}
                  max="9999-12-31"
                  value={arrival_date}
                  onChange={(event) => setArrivalDate(event.target.value)}
                />
              </label>
              {isCalendarDate(arrival_date) && trip.end_date && arrival_date > trip.end_date && (
                <p className="city-date-note">
                  Your trip will extend to {formatTripDates(arrival_date, '')}.
                </p>
              )}
              {first_open_day && isCalendarDate(arrival_date) && arrival_date > first_open_day && (
                <p className="city-date-note">
                  Day 1 in {trip.cities?.[0]} starts on {formatTripDates(first_open_day, '')}.
                </p>
              )}
              {arrival_date ? (
                <button type="button" className="city-date-link" onClick={() => setArrivalDate('')}>
                  Choose date later
                </button>
              ) : (
                <p className="city-date-note">You can set the travel date in Edit trip.</p>
              )}
            </fieldset>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <footer className="dialog-footer">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => {
                  setError('');
                  setSelected(null);
                }}
              >
                Back
              </button>
              <button type="button" className="primary" disabled={busy} onClick={save}>
                {busy ? 'Saving…' : 'Add city'}
              </button>
            </footer>
          </>
        )}
      </EditorForm>
    </Dialog>
  );
}
