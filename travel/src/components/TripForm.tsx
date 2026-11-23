import { useState } from 'react';
import type { Trip } from '../lib/types';
import { text_limits } from '../lib/model';
import { Dialog, DiscardPrompt } from './Dialog';
import { EditorForm } from './EditorForm';
import { CityPicker } from './CityPicker';
import { TripCities, type CityLegDraft } from './TripCities';
import '../trip-form.css';

export function TripForm({
  trip,
  onSave,
  onCancel,
  onDelete,
}: {
  trip: Trip;
  onSave(trip: Trip): Promise<void>;
  onCancel(): void;
  onDelete?(): void;
}) {
  const [legs, setLegs] = useState<CityLegDraft[]>(() =>
    (trip.cities ?? []).map((city, index) => ({
      city,
      arrival_date: trip.city_arrival_dates?.[index] ?? '',
      location: trip.city_locations?.[index],
    })),
  );
  const cities = legs.map((leg) => leg.city);
  const [city_index, setCityIndex] = useState<number | null>(null);
  const [title, setTitle] = useState(trip.title);
  const [description, setDescription] = useState(trip.description);
  const [start_date, setStartDate] = useState(trip.start_date);
  const [end_date, setEndDate] = useState(trip.end_date);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [discard, setDiscard] = useState(false);
  const dirty =
    cities.length !== (trip.cities?.length ?? 0) ||
    legs.some(
      (leg, index) =>
        leg.city !== trip.cities?.[index] ||
        leg.location?.id !== trip.city_locations?.[index]?.id ||
        leg.arrival_date !== (trip.city_arrival_dates?.[index] ?? ''),
    ) ||
    title !== trip.title ||
    description !== trip.description ||
    start_date !== trip.start_date ||
    end_date !== trip.end_date;
  async function submit() {
    if (busy || !title.trim()) return;
    setDiscard(false);
    setBusy(true);
    setError('');
    try {
      await onSave({
        id: trip.id,
        title: title.trim(),
        ...(cities.length > 0 && {
          cities,
          city_arrival_dates: legs.map((leg) => leg.arrival_date),
          city_locations: legs.some((leg) => leg.location)
            ? legs.map((leg) => leg.location ?? null)
            : undefined,
        }),
        description: description.trim(),
        start_date,
        end_date,
        created_at: trip.created_at,
        updated_at: new Date().toISOString(),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save this trip.');
    } finally {
      setBusy(false);
    }
  }
  const city_picker = city_index !== null && (
    <CityPicker
      title={
        cities.length === 0
          ? 'Choose a city'
          : city_index === cities.length
            ? 'Add a city'
            : 'Change city'
      }
      excluded_cities={legs
        .filter((_, i) => Math.abs(city_index - i) === 1)
        .map((leg) => ({ name: leg.city, location: leg.location }))}
      onSelect={(city, location) => {
        const next = [...legs];
        next[city_index] = { city, location, arrival_date: legs[city_index]?.arrival_date ?? '' };
        setLegs(next);
        setCityIndex(null);
      }}
      onDismiss={() => setCityIndex(null)}
    />
  );
  return (
    <>
      <Dialog
        title="Edit trip"
        full_screen
        dismiss_disabled={busy}
        onDismiss={() => (dirty ? setDiscard(true) : onCancel())}
      >
        <EditorForm onSave={submit}>
          {(save) => (
            <>
              <fieldset disabled={busy} className="form-body">
                <TripCities
                  legs={legs}
                  start_date={start_date}
                  end_date={end_date}
                  onPick={setCityIndex}
                  onChange={setLegs}
                />
                <label>
                  Trip name
                  <input
                    required
                    maxLength={text_limits.trip_title}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="A week by the sea"
                  />
                </label>
                <div className="form-grid">
                  <label>
                    Start date <span className="optional">optional</span>
                    <input
                      type="date"
                      value={start_date}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </label>
                  <label>
                    End date <span className="optional">optional</span>
                    <input
                      type="date"
                      min={start_date || undefined}
                      value={end_date}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </label>
                </div>
                <label>
                  Description <span className="optional">optional</span>
                  <textarea
                    rows={3}
                    maxLength={text_limits.trip_description}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </label>
                {onDelete && (
                  <button type="button" className="text-danger" onClick={onDelete}>
                    Delete trip
                  </button>
                )}
              </fieldset>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              {discard && (
                <DiscardPrompt
                  disabled={busy}
                  onKeep={() => setDiscard(false)}
                  onDiscard={() => {
                    if (!busy) onCancel();
                  }}
                />
              )}
              <footer className="dialog-footer">
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => (dirty ? setDiscard(true) : onCancel())}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={save}
                  disabled={busy || !title.trim()}
                >
                  {busy ? 'Saving…' : 'Save trip'}
                </button>
              </footer>
            </>
          )}
        </EditorForm>
      </Dialog>
      {city_picker}
    </>
  );
}
