import { ChannelNameDialog } from './ChannelNameDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Channel, Recording } from '../lib/types';
import type { RecorderController } from '../lib/useRecorder';
import { languageName, noteTime, type ChannelNote } from '../lib/recordings';
import { AudioPlayer } from './AudioPlayer';
import { TextNoteCard } from './TextNoteCard';
import { Icon } from './Icon';
import { TranscriptionStatus } from './TranscriptionStatus';
import { useRecordingDraft } from './useRecordingDraft';

type DirtyHandler = (id: string, dirty: boolean) => void;
const empty_notes: ChannelNote[] = [];

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
        <ConfirmDialog
          title="Delete this voice note?"
          description="This permanently removes its audio and transcript from the channel."
          confirm_label="Delete note"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            void controller.remove(recording);
          }}
        />
      )}
      <footer className="clip-meta">
        {recording.transcript && recording.transcript.language !== 'und' && (
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
            aria-haspopup="dialog"
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
  const [renaming, setRenaming] = useState(false);
  const [confirm_delete, setConfirmDelete] = useState(false);
  const messages = useRef<HTMLDivElement>(null);
  const message_list = useRef<HTMLDivElement>(null);
  const previous_ids = useRef<Set<string> | null>(null);
  const follow_end = useRef(true);
  const notes = controller.channel_notes.get(channel.id) ?? empty_notes;
  const has_draft = Boolean(controller.text_drafts.get(channel.id)?.trim());
  useLayoutEffect(() => {
    const container = messages.current;
    if (!container) return;
    const added_note = notes.some((note) => !previous_ids.current?.has(note.id));
    const editing_current = Boolean(container.querySelector('.clip-editor'));
    if (editing_current) follow_end.current = false;
    if (!editing_current && (previous_ids.current === null || added_note || follow_end.current)) {
      // Immediate scrolling also respects reduced-motion preferences.
      container.scrollTop = container.scrollHeight;
      follow_end.current = true;
    }
    previous_ids.current = new Set(notes.map((note) => note.id));
  }, [notes]);
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
            {notes.length} {notes.length === 1 ? 'note' : 'notes'}
          </p>
        </div>
        <div className="channel-tools">
          <button
            className="icon-button"
            aria-label="Rename channel"
            aria-haspopup="dialog"
            onClick={() => setRenaming(true)}
            disabled={controller.busy}
          >
            <Icon name="edit" size={17} />
          </button>
          <button
            className="icon-button"
            aria-label="Delete empty channel"
            aria-haspopup="dialog"
            title={
              notes.length || has_draft
                ? 'Clear this channel’s notes and draft before deleting it'
                : 'Delete empty channel'
            }
            disabled={
              Boolean(notes.length) ||
              has_draft ||
              controller.busy ||
              controller.active_capture?.channel_id === channel.id
            }
            onClick={() => setConfirmDelete(true)}
          >
            <Icon name="trash" size={17} />
          </button>
        </div>
      </header>
      {renaming && (
        <ChannelNameDialog
          channel={channel}
          controller={controller}
          onClose={() => setRenaming(false)}
          onDirtyChange={onDirtyChange}
        />
      )}
      {confirm_delete && (
        <ConfirmDialog
          title={`Delete “${channel.title}”?`}
          description="This empty channel will be removed from your library."
          confirm_label="Delete channel"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            void controller.removeChannel(channel);
          }}
        />
      )}
      <div
        ref={messages}
        className="channel-messages"
        role="region"
        aria-label="Channel notes"
        tabIndex={0}
        onScroll={(event) => {
          const container = event.currentTarget;
          follow_end.current =
            !container.querySelector('.clip-editor') &&
            container.scrollHeight - container.scrollTop - container.clientHeight < 64;
        }}
      >
        <div ref={message_list} className="channel-message-list">
          {notes.length ? (
            notes.map((note) => {
              const date = new Date(noteTime(note));
              const day = date.toLocaleDateString(undefined, {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              });
              const show_day = day !== previous_day;
              previous_day = day;
              return (
                <div key={note.id} className="clip-entry">
                  {show_day && (
                    <div className="timeline-date">
                      <span>{day}</span>
                    </div>
                  )}
                  {'text' in note ? (
                    <TextNoteCard note={note} controller={controller} />
                  ) : (
                    <ClipCard
                      recording={note}
                      controller={controller}
                      onModel={onModel}
                      onDirtyChange={onDirtyChange}
                    />
                  )}
                </div>
              );
            })
          ) : (
            <div className="channel-empty">
              <span className="channel-empty-icon">
                <Icon name="chat" size={24} />
              </span>
              <h3>No notes yet</h3>
              <p>Type a note or tap the microphone to record.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
