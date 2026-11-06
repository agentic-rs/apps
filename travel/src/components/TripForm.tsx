import { useState } from 'react';
import type { Trip } from '../lib/types';
import { text_limits } from '../lib/model';
import { createId } from '../lib/identity';
import { Dialog, DiscardPrompt } from './Dialog';
import { EditorForm } from './EditorForm';

export function TripForm({
  trip,
  onSave,
  onCancel,
}: {
  trip?: Trip;
  onSave(trip: Trip): Promise<void>;
  onCancel(): void;
}) {
  const [title, setTitle] = useState(trip?.title ?? '');
  const [description, setDescription] = useState(trip?.description ?? '');
  const [start_date, setStartDate] = useState(trip?.start_date ?? '');
  const [end_date, setEndDate] = useState(trip?.end_date ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [discard, setDiscard] = useState(false);
  const dirty =
    title !== (trip?.title ?? '') ||
    description !== (trip?.description ?? '') ||
    start_date !== (trip?.start_date ?? '') ||
    end_date !== (trip?.end_date ?? '');
  async function submit() {
    if (busy) return;
    setDiscard(false);
    setBusy(true);
    setError('');
    const now = new Date().toISOString();
    try {
      await onSave({
        id: trip?.id ?? createId(),
        title: title.trim(),
        description: description.trim(),
        start_date,
        end_date,
        created_at: trip?.created_at ?? now,
        updated_at: now,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save this trip.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={trip ? 'Edit trip' : 'A new adventure'}
      full_screen
      onDismiss={() => {
        if (!busy) dirty ? setDiscard(true) : onCancel();
      }}
    >
      <EditorForm onSave={submit}>
        {(save) => (
          <>
            <fieldset disabled={busy} className="form-body">
              <p className="muted">A weekend away or a journey across the world. Give it a home.</p>
              <label>
                Trip name
                <input
                  required
                  maxLength={text_limits.trip_title}
                  autoFocus
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
                A little about the trip <span className="optional">optional</span>
                <textarea
                  rows={3}
                  maxLength={text_limits.trip_description}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Slow mornings, unfamiliar streets, and a few good stories…"
                />
              </label>
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
                {busy ? 'Saving…' : trip ? 'Save trip' : 'Create trip'}
              </button>
            </footer>
          </>
        )}
      </EditorForm>
    </Dialog>
  );
}
