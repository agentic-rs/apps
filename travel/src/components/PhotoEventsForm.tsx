import { useEffect, useRef, useState } from 'react';
import { newEventDraft, eventFromDraft, type EventDraft } from '../lib/photo-event-draft';
import { supported_image_types, readCoordinates } from '../lib/model';
import { readPhotoMetadata } from '../lib/photo-metadata';
import { groupEventPhotos, type EventPhoto } from '../lib/photo-groups';
import type { CheckIn, PhotoAsset, TravelPlatform, Trip } from '../lib/types';
import { Dialog, DiscardPrompt } from './Dialog';
import { EditorForm } from './EditorForm';
import { Icon } from './Icon';
import { EventReviewCard } from './EventReviewCard';
import { DraftPhotos } from './DraftPhotos';

export function PhotoEventsForm({
  trip,
  platform,
  onCancel,
  onSave,
}: {
  trip: Trip;
  platform: TravelPlatform;
  onCancel(photos: PhotoAsset[]): Promise<void>;
  onSave(events: CheckIn[], unused: PhotoAsset[]): Promise<void>;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const imported = useRef<PhotoAsset[]>([]);
  const generation = useRef<AbortController | null>(null);
  const [selected, setSelected] = useState<EventPhoto[]>([]);
  const [drafts, setDrafts] = useState<EventDraft[] | null>(null);
  const [working, setWorking] = useState('');
  const [generation_status, setGenerationStatus] = useState('');
  const [discard, setDiscard] = useState(false);
  const [error, setError] = useState('');
  const busy = Boolean(working || generation_status);

  useEffect(() => () => generation.current?.abort(), []);

  function updateDraft(id: string, change: Partial<EventDraft>) {
    setDrafts(
      (current) =>
        current?.map((draft) => (draft.id === id ? { ...draft, ...change } : draft)) ?? null,
    );
  }

  async function choosePhotos(files?: FileList) {
    if (busy) return;
    setError('');
    setDiscard(false);
    setWorking('Reading photos…');
    const inputs = files ? Array.from(files) : [undefined];
    const added: EventPhoto[] = [];
    let failures = 0;
    let message = '';
    for (const file of inputs) {
      try {
        const asset = await platform.importPhoto(file);
        if (!asset) continue;
        imported.current.push(asset);
        const metadata = await readPhotoMetadata(file ?? (await platform.readPhoto(asset)));
        added.push({ asset, metadata });
      } catch (reason) {
        failures++;
        message = reason instanceof Error ? reason.message : 'Could not read the selected file.';
      }
    }
    setSelected((items) => [...items, ...added]);
    if (failures)
      setError(`${failures} ${failures === 1 ? 'photo' : 'photos'} could not be added. ${message}`);
    if (picker.current) picker.current.value = '';
    setWorking('');
  }

  function stopGenerating() {
    generation.current?.abort();
    generation.current = null;
    setGenerationStatus('');
  }

  async function suggestTitles(events: EventDraft[]) {
    const controller = new AbortController();
    generation.current = controller;
    setError('');
    for (const [index, event] of events.entries()) {
      if (controller.signal.aborted) break;
      try {
        const location = readCoordinates(event.latitude, event.longitude);
        if (!event.local_time && !location) continue;
        setGenerationStatus(
          events.length === 1
            ? 'Suggesting title…'
            : `Suggesting title ${index + 1} of ${events.length}…`,
        );
        const title = await platform.generateEventTitle(
          {
            local_time: event.local_time,
            utc_offset_minutes: event.offset ? Number(event.offset) : null,
            location,
          },
          controller.signal,
        );
        if (!controller.signal.aborted) updateDraft(event.id, { title, title_error: '' });
      } catch (reason) {
        if (!controller.signal.aborted) {
          updateDraft(event.id, {
            title_error:
              reason instanceof Error
                ? reason.message
                : 'Could not suggest a title. Try again or enter one.',
          });
        }
      }
    }
    if (generation.current === controller) {
      generation.current = null;
      setGenerationStatus('');
    }
  }

  function review() {
    if (busy || !selected.length) return;
    const events = groupEventPhotos(selected).map(newEventDraft);
    setError('');
    setDiscard(false);
    setDrafts(events);
    if (platform.native) void suggestTitles(events);
  }

  async function cancel() {
    if (working) return;
    stopGenerating();
    setWorking('Closing…');
    try {
      await onCancel(imported.current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not close this import.');
      setWorking('');
    }
  }

  function dismiss() {
    if (working) return;
    stopGenerating();
    if (imported.current.length) setDiscard(true);
    else void cancel();
  }

  async function save() {
    if (busy || !included.length) return;
    setError('');
    setDiscard(false);
    setWorking('Saving…');
    try {
      const now = new Date().toISOString();
      const events = included.map((draft) => eventFromDraft(draft, trip.id, now));
      const retained = new Set(events.flatMap((event) => event.photos.map((photo) => photo.id)));
      await onSave(
        events,
        imported.current.filter((asset) => !retained.has(asset.id)),
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Could not save these events. Try again.',
      );
      setWorking('');
    }
  }

  const included = drafts?.filter((draft) => draft.included) ?? [];
  const count = included.length;
  return (
    <Dialog title="Events from photos" full_screen onDismiss={dismiss}>
      <EditorForm onSave={drafts ? save : async () => review()}>
        {(submit) => (
          <>
            <fieldset className="form-body photo-events-form" disabled={busy || discard}>
              <p className="muted">
                In <strong>{trip.title}</strong>
              </p>
              {drafts === null ? (
                <>
                  <p>
                    Choose pictures from your trip. Fieldnotes groups them by capture time and
                    location.
                  </p>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      platform.native ? void choosePhotos() : picker.current?.click()
                    }
                  >
                    <Icon name="photo" size={18} /> Choose photos
                  </button>
                  <input
                    ref={picker}
                    type="file"
                    className="hidden-input"
                    accept={supported_image_types.join(',')}
                    multiple
                    onChange={(e) => {
                      if (e.target.files?.length) void choosePhotos(e.target.files);
                    }}
                  />
                  {selected.length > 0 && (
                    <>
                      <p className="selection-count">
                        {selected.length}{' '}
                        {selected.length === 1 ? 'photo selected' : 'photos selected'}
                      </p>
                      <DraftPhotos
                        photos={selected.map(({ asset }) => asset)}
                        platform={platform}
                        onRemove={(id) =>
                          setSelected((photos) => photos.filter((item) => item.asset.id !== id))
                        }
                      />
                    </>
                  )}
                  {platform.native && (
                    <p className="field-help import-title-help">
                      Reviewing events sends each event’s time and coordinates to your active Apell
                      model for a title suggestion.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p>
                    {drafts.length} {drafts.length === 1 ? 'event' : 'events'} from{' '}
                    {selected.length} {selected.length === 1 ? 'photo' : 'photos'}. Review the
                    details before saving.
                  </p>
                  {!platform.native && (
                    <p className="field-help">
                      Enter titles here. AI title suggestions are available in Apell.
                    </p>
                  )}
                  {drafts.map((draft, index) => (
                    <EventReviewCard
                      key={draft.id}
                      draft={draft}
                      number={index + 1}
                      platform={platform}
                      onChange={(change) => updateDraft(draft.id, change)}
                      onSuggest={() => void suggestTitles([draft])}
                    />
                  ))}
                </>
              )}
            </fieldset>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {discard && (
              <DiscardPrompt
                disabled={Boolean(working)}
                onKeep={() => setDiscard(false)}
                onDiscard={() => void cancel()}
              />
            )}
            <footer className="dialog-footer" inert={discard}>
              {generation_status ? (
                <>
                  <span className="generation-status" role="status">
                    {generation_status}
                  </span>
                  <button type="button" className="secondary" onClick={stopGenerating}>
                    Stop
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="secondary" disabled={busy} onClick={dismiss}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={busy || (drafts ? !count : !selected.length)}
                    onClick={submit}
                  >
                    {working ||
                      (drafts
                        ? `Save ${count} ${count === 1 ? 'event' : 'events'}`
                        : 'Review events')}
                  </button>
                </>
              )}
            </footer>
          </>
        )}
      </EditorForm>
    </Dialog>
  );
}
