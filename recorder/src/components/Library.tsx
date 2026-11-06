import { useEffect, useState } from 'react';
import type { RecorderController } from '../lib/useRecorder';
import { formatTime } from '../lib/recordings';
import { Icon } from './Icon';
import { transcriptionLabel } from './TranscriptionStatus';

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
  const [channel_name, setChannelName] = useState('');
  const [previous_count, setPreviousCount] = useState(controller.channels.length);
  const documents = controller.recordings.filter((recording) => recording.mode === 'document');
  const shown_documents = documents.filter((recording) =>
    `${recording.title} ${recording.transcript?.text ?? ''}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const shown_channels = controller.channels.filter((channel) =>
    channel.title.toLowerCase().includes(query.toLowerCase()),
  );
  const channel_mode = controller.mode === 'clip';
  useEffect(() => {
    if (controller.channels.length > previous_count) {
      setCreating(false);
      setChannelName('');
    }
    setPreviousCount(controller.channels.length);
  }, [controller.channels.length, previous_count]);
  useEffect(() => {
    setQuery('');
  }, [controller.mode]);
  useEffect(() => {
    onDirtyChange('new-channel', creating && Boolean(channel_name.trim()));
  }, [creating, channel_name, onDirtyChange]);
  useEffect(() => () => onDirtyChange('new-channel', false), [onDirtyChange]);
  const closeCreate = () => {
    setCreating(false);
    setChannelName('');
  };
  return (
    <aside className="library" aria-label={channel_mode ? 'Channels' : 'Documents'}>
      <div className="library-heading">
        <div>
          <p className="eyebrow">Your collection</p>
          <h2>
            {channel_mode ? 'Channels' : 'Documents'}{' '}
            <span>{channel_mode ? controller.channels.length : documents.length}</span>
          </h2>
        </div>
        {channel_mode ? (
          <button
            className="icon-button import-button"
            aria-label="Create channel"
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
        <form
          className="new-channel-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (channel_name.trim()) void controller.createChannel(channel_name.trim());
          }}
        >
          <label>
            <span>Channel name</span>
            <input
              autoFocus
              value={channel_name}
              onChange={(event) => setChannelName(event.target.value)}
              maxLength={100}
              placeholder="Ideas, daily notes, fieldwork…"
            />
          </label>
          <div>
            <button className="text-button" type="button" onClick={closeCreate}>
              Cancel
            </button>
            <button
              className="button button-dark button-small"
              disabled={controller.busy || !channel_name.trim()}
            >
              Create channel
            </button>
          </div>
        </form>
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
              const clips = controller.recordings.filter(
                (recording) => recording.mode === 'clip' && recording.channel_id === channel.id,
              );
              const latest = clips.sort((left, right) =>
                (right.started_at ?? right.created_at).localeCompare(
                  left.started_at ?? left.created_at,
                ),
              )[0];
              return (
                <button
                  className={`recording-item channel-item ${controller.selected_channel_id === channel.id ? 'selected' : ''}`}
                  key={channel.id}
                  onClick={() => onSelectChannel(channel.id)}
                  aria-current={controller.selected_channel_id === channel.id ? 'true' : undefined}
                >
                  <span className="recording-art channel-art">#</span>
                  <span className="recording-summary">
                    <span className="recording-title">{channel.title}</span>
                    <span className="channel-preview">
                      {latest?.transcript?.text ||
                        (clips.length
                          ? 'Audio notes, waiting for words'
                          : 'Ready for your first voice note')}
                    </span>
                    <span className="recording-label">
                      {clips.length} {clips.length === 1 ? 'note' : 'notes'}
                      {latest
                        ? ` · ${new Date(latest.started_at ?? latest.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
                        : ''}
                    </span>
                  </span>
                </button>
              );
            })
          ) : (
            <div className="library-empty">
              <Icon name="chat" size={30} />
              <h3>{query ? 'No matching channels' : 'A place for every thought'}</h3>
              <p>
                {query
                  ? 'Try a different channel name.'
                  : 'Create a channel for quick voice notes. Keep ideas, days, or projects together.'}
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
            <h3>{query ? 'Nothing found' : 'Room for a longer story'}</h3>
            <p>
              {query
                ? 'Try a title or a word from a document.'
                : 'Record or import an interview or meeting. Its transcript becomes an editable document.'}
            </p>
          </div>
        )}
      </div>
      <div className="library-footer">
        <Icon name="lock" size={14} />
        <span>Stored on this device</span>
        <span className="total-time">
          {channel_mode && controller.platform?.native ? 'Auto-transcribed' : 'Private audio'}
        </span>
      </div>
    </aside>
  );
}
