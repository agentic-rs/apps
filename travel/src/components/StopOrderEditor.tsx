import { lazy, Suspense, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cityIndicesOnDay } from '../lib/city-days';
import { daysBetween, itineraryDayLabel } from '../lib/dates';
import { plannedStopCityIndex, searchCityLabel } from '../lib/planned-stop-search';
import { stop_kind_labels, type PlannedStop, type Trip } from '../lib/types';
import { searchCities, useSearchCityLocations } from '../lib/use-search-cities';
import { useStopDrag } from '../lib/use-stop-drag';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { RoutePositionSheet } from './RoutePosition';
import '../stop-order.css';

const ReorderMap = lazy(() => import('./ReorderMap'));
const date_format = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

export function StopOrderEditor({
  trip,
  day,
  first,
  stops,
  native,
  onApply,
  onClose,
}: {
  trip: Trip;
  day: string;
  first: string;
  stops: PlannedStop[];
  native: boolean;
  onApply(original_ids: string[], ordered_ids: string[]): Promise<void>;
  onClose(): void;
}) {
  const [original] = useState(() => stops.slice());
  const by_id = useMemo(() => new Map(original.map((stop) => [stop.id, stop])), [original]);
  const [ids, setIds] = useState(() => original.map((stop) => stop.id));
  const ordered = useMemo(() => ids.map((id) => by_id.get(id)!), [by_id, ids]);
  const [choosing_id, setChoosingId] = useState<string | null>(null);
  const return_grip = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    if (choosing_id || !return_grip.current) return;
    // WebKit restores the parent dialog after the position sheet closes.
    const frame = requestAnimationFrame(() => {
      const grip = return_grip.current;
      grip?.focus({ preventScroll: true });
      grip?.scrollIntoView({ block: 'nearest' });
      return_grip.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [choosing_id]);
  const [save_error, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const save_in_flight = useRef(false);
  const { list_ref, dragging_id, handleProps, cancelDrag } = useStopDrag(ids, changeOrder);
  const cities = useMemo(() => searchCities(trip, cityIndicesOnDay(trip, day)), [trip, day]);
  const resolved = useSearchCityLocations(cities, cities.length > 1);
  const city_labels = useMemo(() => {
    const labels = new Map<string, string>();
    if (cities.length > 1) {
      for (const stop of original) {
        const visit = plannedStopCityIndex(stop, resolved.cities, day);
        if (visit !== undefined) labels.set(stop.id, searchCityLabel(cities, visit));
      }
    }
    return labels;
  }, [original, cities, resolved.cities, day]);
  const choosing = choosing_id ? by_id.get(choosing_id) : undefined;
  const has_map = original.some((stop) => stop.position);
  const date = date_format.format(new Date(day + 'T00:00:00Z'));
  const day_label = itineraryDayLabel(day, first, trip);
  const context = [day_label, cities.map((city) => city.name).join(' → ')]
    .filter(Boolean)
    .join(' · ');

  function changeOrder(order: string[]) {
    setSaveError('');
    setIds(order);
  }

  function cancel() {
    if (!save_in_flight.current && !cancelDrag()) onClose();
  }

  async function done() {
    if (save_in_flight.current || dragging_id) return;
    if (ids.every((id, i) => id === original[i].id)) {
      onClose();
      return;
    }
    save_in_flight.current = true;
    setSaving(true);
    setSaveError('');
    try {
      await onApply(
        original.map((stop) => stop.id),
        ids,
      );
      onClose();
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : 'Could not save the stop order. Try again.',
      );
      setSaving(false);
      save_in_flight.current = false;
    }
  }

  return (
    <>
      <Dialog
        title="Reorder stops"
        full_screen
        onDismiss={cancel}
        dismiss_disabled={saving}
        leading_action={
          <button type="button" className="stop-order-cancel" disabled={saving} onClick={cancel}>
            Cancel
          </button>
        }
        trailing_action={
          <button
            type="button"
            className="stop-order-done"
            disabled={saving || dragging_id !== null}
            onClick={() => void done()}
          >
            {saving ? 'Saving…' : 'Done'}
          </button>
        }
      >
        <div className="stop-order-body" data-map={has_map || undefined}>
          {has_map && (
            <div className="stop-order-map">
              <Suspense
                fallback={
                  <p className="map-loading" role="status">
                    Opening map…
                  </p>
                }
              >
                <ReorderMap stops={ordered} native={native} highlighted_id={dragging_id} />
              </Suspense>
            </div>
          )}
          <section className="stop-order-panel" aria-label="Day order">
            <header className="stop-order-context">
              <h3>{context}</h3>
              <time dateTime={day}>{date}</time>
            </header>
            <div className="stop-order-scroll">
              <ol ref={list_ref} className="stop-order-list" aria-label="Stop order">
                {ordered.map((stop, i) => {
                  const nights = stop.checkout_date ? daysBetween(stop.day, stop.checkout_date) : 0;
                  const details = [
                    stop_kind_labels[stop.kind],
                    city_labels.get(stop.id) ?? (cities.length !== 1 ? stop.city : ''),
                    stop.time,
                    nights ? `${nights} ${nights === 1 ? 'night' : 'nights'}` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <li
                      key={stop.id}
                      data-stop-id={stop.id}
                      data-dragging={dragging_id === stop.id || undefined}
                    >
                      <span className="stop-order-number" aria-hidden="true">
                        {i + 1}
                      </span>
                      <span className="stop-order-name">
                        <strong>{stop.title}</strong>
                        <small>{details}</small>
                      </span>
                      <button
                        type="button"
                        className="stop-order-grip"
                        aria-label={`Move ${stop.title}`}
                        aria-description={`Position ${i + 1} of ${ids.length}. Tap to choose a position.`}
                        aria-haspopup="dialog"
                        disabled={saving}
                        {...handleProps(stop.id)}
                        onClick={(event) => {
                          return_grip.current = event.currentTarget;
                          setChoosingId(stop.id);
                        }}
                      >
                        <Icon name="grip" size={21} />
                      </button>
                    </li>
                  );
                })}
              </ol>
              <p className="stop-order-hint">Drag a handle, or tap it to choose a position.</p>
            </div>
            {save_error && (
              <p className="form-error" role="alert">
                {save_error}
              </p>
            )}
          </section>
        </div>
      </Dialog>
      {choosing && (
        <RoutePositionSheet
          stops={ordered.filter((stop) => stop.id !== choosing.id)}
          index={ids.indexOf(choosing.id)}
          title={choosing.title}
          context={context}
          city_labels={city_labels}
          back_label="Back to stop order"
          onClose={() => setChoosingId(null)}
          onChange={(before_id) => {
            const others = ids.filter((id) => id !== choosing.id);
            const slot = before_id === null ? others.length : others.indexOf(before_id);
            others.splice(slot, 0, choosing.id);
            changeOrder(others);
          }}
        />
      )}
    </>
  );
}
