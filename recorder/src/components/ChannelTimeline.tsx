import { useEffect, useMemo, useRef, useState } from 'react';
import type { Channel, Recording } from '../lib/types';
import type { RecorderController } from '../lib/useRecorder';
import { languageName } from '../lib/recordings';
import { AudioPlayer } from './AudioPlayer';
import { Icon } from './Icon';
import { TranscriptionStatus } from './TranscriptionStatus';
import { useRecordingDraft } from './useRecordingDraft';

type DirtyHandler = (id: string, dirty: boolean) => void;

function ClipCard({
  recording,
  controller,
  onModel,
  onDirtyChange,
}: {
  recording: Recording;
  controller: RecorderController;
  onModel: () => void;
  onDirtyChange: DirtyHandler;
}) {
  const draft = useRecordingDraft(recording, controller);
  const [editing, setEditing] = useState(false);
  const [confirm_delete, setConfirmDelete] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  const time = new Date(recording.started_at ?? recording.created_at);
  useEffect(() => {
    onDirtyChange(recording.id, draft.dirty);
  }, [recording.id, draft.dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(recording.id, false), [recording.id, onDirtyChange]);
  useEffect(() => {
    if (!editing) return;
    const reveal = () => editor.current?.scrollIntoView({ block: 'center' });
    const frame = requestAnimationFrame(reveal);
    window.visualViewport?.addEventListener('resize', reveal);
    return () => {
      cancelAnimationFrame(frame);
      window.visualViewport?.removeEventListener('resize', reveal);
    };
  }, [editing]);
  return (
    <article
      className="clip-card"
      aria-label={`Voice note at ${time.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`}
    >
      <div className="clip-card-header">
        <span className="clip-avatar">
          <Icon name="mic" size={15} />
        </span>
        <strong>{recording.source === 'import' ? recording.title : 'Voice note'}</strong>
        <time dateTime={time.toISOString()}>
          {time.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
        </time>
        <button
          className="icon-button"
          aria-label="Delete voice note"
          disabled={controller.busy || draft.dirty || controller.audio.recording_state !== 'idle'}
          onClick={() => setConfirmDelete(true)}
        >
          <Icon name="trash" size={15} />
        </button>
      </div>
      <AudioPlayer recording={recording} controller={controller} compact />
      {recording.transcript && (
        <div className="clip-text">
          {editing ? (
            <label>
              <span className="sr-only">Voice note text</span>
              <textarea
                ref={editor}
                className="clip-editor"
                autoFocus
                value={draft.text}
                onChange={(event) => draft.setText(event.target.value)}
                spellCheck
              />
            </label>
          ) : (
            <p>{draft.text || <span className="muted">No speech was detected.</span>}</p>
          )}
          <div className="clip-text-actions">
            <span>
              {languageName(recording.transcript.language)}
              {recording.transcript_edited ? ' · Edited' : ''}
            </span>
            <button className="text-button" onClick={() => setEditing(!editing)}>
              <Icon name={editing ? 'check' : 'edit'} size={13} />
              {editing ? 'View' : 'Edit text'}
            </button>
            <button
              className="text-button"
              aria-label="Share voice note text"
              disabled={
                controller.busy ||
                draft.dirty ||
                !controller.capabilities.sharing ||
                controller.audio.recording_state !== 'idle'
              }
              onClick={() => void controller.shareTranscript(recording)}
            >
              <Icon name="share" size={13} />
            </button>
          </div>
        </div>
      )}
      <TranscriptionStatus
        recording={recording}
        controller={controller}
        onModel={onModel}
        dirty={draft.dirty}
        compact
      />
      {draft.dirty && (
        <div className="save-bar">
          <span>Unsaved text</span>
          <button
            className="text-button"
            disabled={controller.busy}
            onClick={() => {
              draft.discard();
              setEditing(false);
            }}
          >
            Discard
          </button>
          <button
            className="button button-dark button-small"
            disabled={controller.busy}
            onClick={() => void draft.save()}
          >
            Save text
          </button>
        </div>
      )}
      {confirm_delete && (
        <div className="inline-confirm" role="alert">
          <strong>Delete this voice note?</strong>
          <p>Its audio and transcript will be removed. Other notes stay in the channel.</p>
          <div>
            <button
              className="button button-small"
              onClick={() => setConfirmDelete(false)}
              disabled={controller.busy}
            >
              Keep note
            </button>
            <button
              className="button button-danger button-small"
              onClick={() => void controller.remove(recording)}
              disabled={controller.busy}
            >
              Delete note
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

export function ChannelTimeline({
  channel,
  controller,
  onBack,
  onModel,
  onDirtyChange,
}: {
  channel: Channel;
  controller: RecorderController;
  onBack: () => void;
  onModel: () => void;
  onDirtyChange: DirtyHandler;
}) {
  const [rename_value, setRenameValue] = useState<string | null>(null);
  const [confirm_delete, setConfirmDelete] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const previous_count = useRef<number | null>(null);
  const clips = useMemo(
    () =>
      controller.recordings
        .filter((recording) => recording.mode === 'clip' && recording.channel_id === channel.id)
        .sort(
          (left, right) =>
            (left.started_at ?? left.created_at).localeCompare(
              right.started_at ?? right.created_at,
            ) || left.id.localeCompare(right.id),
        ),
    [controller.recordings, channel.id],
  );
  const rename_dirty = rename_value !== null && rename_value !== channel.title;
  const channel_key = `channel-${channel.id}`;
  useEffect(() => {
    onDirtyChange(channel_key, rename_dirty);
  }, [channel_key, rename_dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(channel_key, false), [channel_key, onDirtyChange]);
  useEffect(() => {
    setRenameValue(null);
  }, [channel.title]);
  useEffect(() => {
    const container = end.current?.closest('.app-scroll');
    if (!container) return;
    const near_bottom = container.scrollHeight - container.scrollTop - container.clientHeight < 220;
    if (previous_count.current === null || (clips.length > previous_count.current && near_bottom))
      end.current?.scrollIntoView({ block: 'end' });
    previous_count.current = clips.length;
  }, [clips.length]);
  let previous_day = '';
  return (
    <section className="channel-detail" aria-label="Channel timeline">
      <header className="channel-header">
        <div className="detail-topline">
          <button className="text-button back-button" onClick={onBack}>
            <Icon name="back" size={17} />
            Channels
          </button>
          <span className="eyebrow">Small moments, in one place</span>
          <div className="inline-actions">
            <button
              className="icon-button"
              aria-label="Rename channel"
              onClick={() => setRenameValue(channel.title)}
              disabled={controller.busy || rename_value !== null}
            >
              <Icon name="edit" size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="Delete empty channel"
              title={
                clips.length
                  ? 'Remove the voice notes before deleting this channel'
                  : 'Delete empty channel'
              }
              disabled={
                Boolean(clips.length) ||
                controller.busy ||
                rename_dirty ||
                controller.active_capture?.channel_id === channel.id
              }
              onClick={() => setConfirmDelete(true)}
            >
              <Icon name="trash" size={17} />
            </button>
          </div>
        </div>
        {rename_value !== null ? (
          <form
            className="channel-rename"
            onSubmit={(event) => {
              event.preventDefault();
              if (rename_value.trim()) void controller.renameChannel(channel, rename_value.trim());
            }}
          >
            <label>
              <span className="sr-only">Channel name</span>
              <input
                value={rename_value}
                maxLength={100}
                onChange={(event) => setRenameValue(event.target.value)}
                autoFocus
              />
            </label>
            <button
              className="button button-dark button-small"
              disabled={controller.busy || !rename_value.trim() || !rename_dirty}
            >
              Save name
            </button>
            <button type="button" className="text-button" onClick={() => setRenameValue(null)}>
              Cancel
            </button>
          </form>
        ) : (
          <h2>
            <span className="channel-hash">#</span>
            {channel.title}
          </h2>
        )}
        <p>
          {clips.length
            ? `${clips.length} ${clips.length === 1 ? 'voice note' : 'voice notes'} · Each moment keeps its own audio and transcript.`
            : 'A home for quick thoughts, daily notes, and things to remember.'}
        </p>
      </header>
      {confirm_delete && (
        <div className="inline-confirm" role="alert">
          <strong>Delete this empty channel?</strong>
          <div>
            <button className="button button-small" onClick={() => setConfirmDelete(false)}>
              Keep channel
            </button>
            <button
              className="button button-danger button-small"
              disabled={controller.busy}
              onClick={() => void controller.removeChannel(channel)}
            >
              Delete channel
            </button>
          </div>
        </div>
      )}
      <div className="channel-messages">
        {clips.length ? (
          clips.map((recording) => {
            const date = new Date(recording.started_at ?? recording.created_at);
            const day = date.toLocaleDateString(undefined, {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            });
            const show_day = day !== previous_day;
            previous_day = day;
            return (
              <div key={recording.id} className="clip-entry">
                {show_day && (
                  <div className="timeline-date">
                    <span>{day}</span>
                  </div>
                )}
                <ClipCard
                  recording={recording}
                  controller={controller}
                  onModel={onModel}
                  onDirtyChange={onDirtyChange}
                />
              </div>
            );
          })
        ) : (
          <div className="channel-empty">
            <span className="channel-empty-icon">
              <Icon name="mic" size={32} />
            </span>
            <h3>Start with a thought.</h3>
            <p>
              Record a short note below. Every note gets a timestamp,
              <br />
              {controller.platform?.native
                ? 'its own audio, and an automatic transcript.'
                : 'its own audio. Transcription is available in Apell.'}
            </p>
            <span className="channel-example">
              <Icon name="lock" size={13} />
              Only on this device
            </span>
          </div>
        )}
        <div ref={end} />
      </div>
    </section>
  );
}
