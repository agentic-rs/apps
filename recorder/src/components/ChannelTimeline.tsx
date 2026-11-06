import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  const [actions_open, setActionsOpen] = useState(false);
  const expanded = actions_open || editing || draft.dirty;
  const [confirm_delete, setConfirmDelete] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  const time = new Date(recording.started_at ?? recording.created_at);
  useEffect(() => {
    onDirtyChange(recording.id, draft.dirty);
  }, [recording.id, draft.dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(recording.id, false), [recording.id, onDirtyChange]);
  useEffect(() => {
    if (!editing) return;
    const reveal = () => {
      const field = editor.current;
      const container = field?.closest<HTMLElement>('.channel-messages');
      if (!field || !container) return;
      const field_bounds = field.getBoundingClientRect();
      const container_bounds = container.getBoundingClientRect();
      container.scrollTop +=
        field_bounds.top -
        container_bounds.top -
        Math.max(0, (container.clientHeight - field_bounds.height) / 2);
    };
    const frame = requestAnimationFrame(reveal);
    window.visualViewport?.addEventListener('resize', reveal);
    return () => {
      cancelAnimationFrame(frame);
      window.visualViewport?.removeEventListener('resize', reveal);
    };
  }, [editing]);
  return (
    <article
      className={`clip-card clip-bubble ${expanded ? 'actions-open' : ''}`}
      aria-label={`Voice note at ${time.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`}
    >
      {recording.source === 'import' && <p className="clip-source">{recording.title}</p>}
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
            <p>
              {recording.transcript.text || <span className="muted">No speech was detected.</span>}
            </p>
          )}
          {expanded && (
            <div className="clip-text-actions">
              <button
                className="text-button"
                disabled={editing && draft.dirty}
                onClick={() => setEditing(!editing)}
              >
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
          )}
        </div>
      )}
      <TranscriptionStatus
        recording={recording}
        controller={controller}
        onModel={onModel}
        dirty={draft.dirty}
        expanded={expanded}
        compact
      />
      {(draft.dirty || editing) && (
        <div className="save-bar">
          <span>{draft.dirty ? 'Unsaved text' : 'Editing text'}</span>
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
            disabled={controller.busy || !draft.dirty}
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
      <footer className="clip-meta">
        {recording.transcript && (
          <span className="clip-language">
            {languageName(recording.transcript.language)}
            {recording.transcript_edited ? ' · Edited' : ''}
          </span>
        )}
        <time dateTime={time.toISOString()}>
          {time.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
        </time>
        {expanded && (
          <button
            className="icon-button clip-delete"
            aria-label="Delete voice note"
            disabled={controller.busy || draft.dirty || controller.audio.recording_state !== 'idle'}
            onClick={() => setConfirmDelete(true)}
          >
            <Icon name="trash" size={14} />
          </button>
        )}
        <button
          className="icon-button clip-more"
          aria-label="Voice note actions"
          aria-expanded={expanded}
          disabled={draft.dirty}
          onClick={() => {
            setActionsOpen(!expanded);
            if (expanded) {
              setEditing(false);
              setConfirmDelete(false);
            }
          }}
        >
          <Icon name="more" size={18} />
        </button>
      </footer>
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
  const messages = useRef<HTMLDivElement>(null);
  const message_list = useRef<HTMLDivElement>(null);
  const previous_ids = useRef<Set<string> | null>(null);
  const follow_end = useRef(true);
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
  const renameChannel = () => {
    if (!controller.busy && rename_dirty && rename_value?.trim())
      void controller.renameChannel(channel, rename_value.trim());
  };
  useEffect(() => {
    onDirtyChange(channel_key, rename_dirty);
  }, [channel_key, rename_dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(channel_key, false), [channel_key, onDirtyChange]);
  useEffect(() => {
    setRenameValue(null);
  }, [channel.title]);
  useLayoutEffect(() => {
    const container = messages.current;
    if (!container) return;
    const added_note = clips.some((clip) => !previous_ids.current?.has(clip.id));
    const editing_current = Boolean(container.querySelector('.clip-editor'));
    if (editing_current) follow_end.current = false;
    if (!editing_current && (previous_ids.current === null || added_note || follow_end.current)) {
      // Immediate scrolling also respects reduced-motion preferences.
      container.scrollTop = container.scrollHeight;
      follow_end.current = true;
    }
    previous_ids.current = new Set(clips.map((clip) => clip.id));
  }, [clips]);
  useEffect(() => {
    const container = messages.current;
    const content = message_list.current;
    if (!container || !content) return;
    const observer = new ResizeObserver(() => {
      // Keep an open editor steady even if another note arrives or grows.
      if (container.querySelector('.clip-editor')) follow_end.current = false;
      // Late transcripts can grow a bubble. Follow only if the reader was at the end.
      if (follow_end.current) container.scrollTop = container.scrollHeight;
    });
    observer.observe(content);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  let previous_day = '';
  return (
    <section className="channel-detail" aria-label="Channel timeline">
      <header className="channel-header">
        <button className="icon-button back-button" onClick={onBack} aria-label="Channels">
          <Icon name="back" size={20} />
        </button>
        <span className="channel-avatar" aria-hidden="true">
          <Icon name="chat" size={21} />
        </span>
        <div className="channel-heading">
          <h2>{channel.title}</h2>
          <p>
            {clips.length} {clips.length === 1 ? 'voice note' : 'voice notes'} · Only you
          </p>
        </div>
        <div className="channel-tools">
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
      </header>
      {rename_value !== null && (
        <div className="channel-rename" role="form" aria-label="Rename channel">
          <label>
            <span className="sr-only">Channel name</span>
            <input
              value={rename_value}
              maxLength={100}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  renameChannel();
                }
              }}
              autoFocus
            />
          </label>
          <button
            className="button button-dark button-small"
            onClick={renameChannel}
            disabled={controller.busy || !rename_value.trim() || !rename_dirty}
          >
            Save name
          </button>
          <button type="button" className="text-button" onClick={() => setRenameValue(null)}>
            Cancel
          </button>
        </div>
      )}
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
      <div
        ref={messages}
        className="channel-messages"
        role="region"
        aria-label="Voice notes"
        tabIndex={0}
        onScroll={(event) => {
          const container = event.currentTarget;
          follow_end.current =
            !container.querySelector('.clip-editor') &&
            container.scrollHeight - container.scrollTop - container.clientHeight < 64;
        }}
      >
        <div ref={message_list} className="channel-message-list">
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
                <Icon name="mic" size={24} />
              </span>
              <h3>Your thoughts, one note at a time.</h3>
              <p>
                {controller.platform?.native
                  ? 'Tap the microphone. Your words will appear here.'
                  : 'Tap the microphone to save a voice note.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
