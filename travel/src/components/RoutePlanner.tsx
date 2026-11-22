import { useMemo, useState } from 'react';
import { routeDistanceKm, suggestDayRoute } from '../lib/route-planner';
import { formatDistance } from '../lib/distance';
import type { PlannedStop } from '../lib/types';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import '../route-planner.css';

interface RoutePlannerProps {
  stops: PlannedStop[];
  onApply(original_ids: string[], ordered_ids: string[]): Promise<void>;
  onClose(): void;
}

export function RoutePlanner({ stops, onApply, onClose }: RoutePlannerProps) {
  // Keep the reviewed order tied to the snapshot the user opened.
  const [original] = useState(() => [...stops]);
  const [start_id, setStart] = useState(original[0]?.id ?? '');
  const [finish_id, setFinish] = useState(original.at(-1)?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [save_error, setSaveError] = useState('');
  const current_km = useMemo(() => routeDistanceKm(original), [original]);
  const missing = original.filter((stop) => !stop.position);
  const ready = original.length >= 2 && current_km !== null;
  const suggested = useMemo(
    () => (ready ? suggestDayRoute(original, start_id, finish_id) : []),
    [original, ready, start_id, finish_id],
  );
  const suggested_km = routeDistanceKm(suggested);
  const changed = suggested.some((stop, i) => original[i].id !== stop.id);

  function chooseStart(id: string) {
    if (id === finish_id) setFinish(start_id);
    setStart(id);
    setSaveError('');
  }

  function chooseFinish(id: string) {
    if (id === start_id) setStart(finish_id);
    setFinish(id);
    setSaveError('');
  }

  async function apply() {
    if (saving || !changed) return;
    setSaving(true);
    setSaveError('');
    try {
      await onApply(
        original.map((stop) => stop.id),
        suggested.map((stop) => stop.id),
      );
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save the route. Try again.');
      setSaving(false);
    }
  }

  return (
    <Dialog
      title="Optimize day route"
      onDismiss={() => {
        if (!saving) onClose();
      }}
    >
      <div className="route-planner">
        {!ready ? (
          original.length < 2 ? (
            <p>Add at least two stops to this day to compare routes.</p>
          ) : (
            <>
              <h3>Stops needing map coordinates</h3>
              <p>Add coordinates to these stops, then open the route again.</p>
              <ul className="route-missing">
                {missing.map((stop) => (
                  <li key={stop.id}>{stop.title}</li>
                ))}
              </ul>
            </>
          )
        ) : (
          <>
            <fieldset className="route-endpoints" disabled={saving}>
              <legend className="sr-only">Route endpoints</legend>
              <label>
                Start stop
                <select value={start_id} onChange={(e) => chooseStart(e.target.value)}>
                  {original.map((stop) => (
                    <option key={stop.id} value={stop.id}>
                      {stop.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Finish stop
                <select value={finish_id} onChange={(e) => chooseFinish(e.target.value)}>
                  {original.map((stop) => (
                    <option key={stop.id} value={stop.id}>
                      {stop.title}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
            <h3>Straight-line distance</h3>
            <dl className="route-distance" aria-live="polite">
              <div>
                <dt>Current</dt>
                <dd>{formatDistance(current_km)}</dd>
              </div>
              <div>
                <dt>Suggested</dt>
                <dd>{formatDistance(suggested_km!)}</dd>
              </div>
            </dl>
            <h3>Suggested order</h3>
            {original.some((stop) => stop.time) && (
              <p className="route-time-note">
                Scheduled times stay with their stops. Check the times before applying.
              </p>
            )}
            <ol className="route-preview" aria-label="Suggested order">
              {suggested.map((stop, index) => (
                <li key={stop.id}>
                  <span aria-hidden="true" className="route-preview-number">
                    {index + 1}
                  </span>
                  <span>{stop.title}</span>
                  {stop.time && <time>{stop.time}</time>}
                </li>
              ))}
            </ol>
            {!changed && <p role="status">Your stops are already in the suggested order.</p>}
          </>
        )}
        {save_error && (
          <p className="form-error" role="alert">
            {save_error}
          </p>
        )}
      </div>
      <footer className="dialog-footer">
        <button type="button" className="secondary" disabled={saving} onClick={onClose}>
          {ready ? 'Cancel' : 'Close'}
        </button>
        {ready && (
          <button
            type="button"
            className="primary"
            disabled={saving || !changed}
            onClick={() => void apply()}
          >
            <Icon name="check" size={16} />
            {saving ? 'Saving…' : 'Apply order'}
          </button>
        )}
      </footer>
    </Dialog>
  );
}
