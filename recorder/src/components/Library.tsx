import { ChannelNameDialog } from './ChannelNameDialog';
import { useEffect, useState } from 'react';
import type { RecorderController } from '../lib/useRecorder';
import { formatTime, noteTime } from '../lib/recordings';
import { Icon } from './Icon';
import { transcriptionLabel } from './TranscriptionStatus';
import recorder_icon from '../../../shared/assets/recorder.svg';

export function Library({
  controller,
  locked,
  onSelectDocument,
  onSelectChannel,
  onDirtyChange,
}: {
  controller: RecorderController;
  locked: boolean;
  onSelectDocument: (id: string | null) => void;
  onSelectChannel: (id: string | null) => void;
  onDirtyChange: (id: string, dirty: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const documents = controller.recordings.filter((recording) => recording.mode === 'document');
  const shown_documents = documents.filter((recording) =>
    `${recording.title} ${recording.transcript?.text ?? ''}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const shown_channels = controller.channels
    .filter((channel) => channel.title.toLowerCase().includes(query.toLowerCase()))
    .sort((left, right) => {
      const a = controller.channel_notes.get(left.id)?.at(-1);
      const b = controller.channel_notes.get(right.id)?.at(-1);
      const a_time = a ? Date.parse(noteTime(a)) : -Infinity;
      const b_time = b ? Date.parse(noteTime(b)) : -Infinity;
      return b_time - a_time || left.title.localeCompare(right.title);
    });
  const channel_mode = controller.mode === 'clip';
  useEffect(() => {
    setQuery('');
  }, [controller.mode]);
  return (
    <aside className="library" aria-label={channel_mode ? 'Channels' : 'Documents'}>
      <div className="library-heading">
        <div className="library-identity">
          <img src={recorder_icon} alt="" className="app-icon" />
          <h2>
            {channel_mode ? 'Channels' : 'Documents'}{' '}
            <span>{channel_mode ? controller.channels.length : documents.length}</span>
          </h2>
        </div>
        {channel_mode ? (
          <button
            className="icon-button import-button"
            aria-label="Create channel"
            aria-haspopup="dialog"
            onClick={() => setCreating(true)}
            disabled={controller.busy || locked}
          >
            <Icon name="plus" size={19} />
          </button>
        ) : (
          <button
            className="icon-button import-button"
            aria-label="Import document audio"
            disabled={
              !controller.capabilities.import ||
              locked ||
              controller.audio.recording_state !== 'idle'
            }
            onClick={() => void controller.importAudio()}
          >
            <Icon name="upload" />
          </button>
        )}
      </div>
      {creating && (
        <ChannelNameDialog
          controller={controller}
          onClose={() => setCreating(false)}
          onDirtyChange={onDirtyChange}
        />
      )}
      <label className="search">
        <Icon name="search" size={17} />
        <span className="sr-only">
          {channel_mode ? 'Search channels' : 'Search documents and transcripts'}
        </span>
        <input
          type="search"
          placeholder={channel_mode ? 'Find a channel' : 'Search your documents'}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="recording-list">
        {controller.loading ? (
          <div className="library-empty" role="status">
            <span className="spinner" />
            <p>Opening your collection…</p>
          </div>
        ) : channel_mode ? (
          shown_channels.length ? (
            shown_channels.map((channel) => {
              const notes = controller.channel_notes.get(channel.id);
              const count = notes?.length ?? 0;
              const latest = notes?.at(-1);
              const date = latest ? new Date(noteTime(latest)) : null;
              return (
                <button
                  className={`recording-item channel-item ${controller.selected_channel_id === channel.id ? 'selected' : ''}`}
                  key={channel.id}
                  onClick={() => onSelectChannel(channel.id)}
                  aria-current={controller.selected_channel_id === channel.id ? 'true' : undefined}
                >
                  <span className="recording-art channel-art">
                    <Icon name="chat" size={23} />
                  </span>
                  <span className="recording-summary">
                    <span className="channel-item-topline">
                      <span className="recording-title">{channel.title}</span>
                      {date && (
                        <time dateTime={date.toISOString()}>
                          {date.toDateString() === new Date().toDateString()
                            ? date.toLocaleTimeString(undefined, {
                                hour: 'numeric',
                                minute: '2-digit',
                              })
                            : date.toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric',
                              })}
                        </time>
                      )}
                    </span>
                    <span className="channel-item-bottomline">
                      <span className="channel-preview">
                        {latest && 'text' in latest ? (
                          <span>{latest.text}</span>
                        ) : latest ? (
                          <>
                            <Icon name="mic" size={13} />
                            <span>{latest.transcript?.text || transcriptionLabel(latest)}</span>
                          </>
                        ) : (
                          'No notes yet'
                        )}
                      </span>
                      <span
                        className="channel-note-count"
                        aria-label={`${count} ${count === 1 ? 'note' : 'notes'}`}
                      >
                        {count} {count === 1 ? 'note' : 'notes'}
                      </span>
                    </span>
                  </span>
                </button>
              );
            })
          ) : (
            <div className="library-empty">
              <Icon name="chat" size={30} />
              <h3>{query ? 'No matching channels' : 'No channels yet'}</h3>
              <p>
                {query
                  ? 'Try a different channel name.'
                  : 'Create a channel for text and voice notes.'}
              </p>
              {!query && !creating && (
                <button className="text-button" onClick={() => setCreating(true)} disabled={locked}>
                  Create your first channel
                  <Icon name="plus" size={14} />
                </button>
              )}
            </div>
          )
        ) : shown_documents.length ? (
          shown_documents.map((recording) => (
            <button
              key={recording.id}
              className={`recording-item ${controller.selected_id === recording.id ? 'selected' : ''}`}
              onClick={() => onSelectDocument(recording.id)}
              aria-current={controller.selected_id === recording.id ? 'true' : undefined}
            >
              <span className="recording-art">
                <Icon name="text" size={22} />
              </span>
              <span className="recording-summary">
                <span className="recording-title">{recording.title}</span>
                <span className="recording-date">
                  {new Date(recording.started_at ?? recording.created_at).toLocaleDateString(
                    undefined,
                    { month: 'short', day: 'numeric' },
                  )}
                  <span>·</span>
                  {formatTime(recording.duration_ms)}
                </span>
                <span className={`recording-label ${recording.transcript ? 'has-transcript' : ''}`}>
                  {transcriptionLabel(recording)}
                </span>
              </span>
            </button>
          ))
        ) : (
          <div className="library-empty">
            <Icon name={query ? 'search' : 'text'} size={30} />
            <h3>{query ? 'No matching documents' : 'No documents yet'}</h3>
            <p>
              {query
                ? 'Try a title or a word from a document.'
                : 'Record or import audio to create a document.'}
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
