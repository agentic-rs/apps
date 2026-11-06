import { useEffect, useMemo, useState } from 'react';
import type { Recording } from '../lib/types';
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
  const summaries = useMemo(() => {
    const result = new Map<string, { count: number; latest: Recording }>();
    for (const recording of controller.recordings) {
      if (recording.mode !== 'clip' || !recording.channel_id) continue;
      const previous = result.get(recording.channel_id);
      const latest =
        !previous ||
        (recording.started_at ?? recording.created_at) >
          (previous.latest.started_at ?? previous.latest.created_at)
          ? recording
          : previous.latest;
      result.set(recording.channel_id, { count: (previous?.count ?? 0) + 1, latest });
    }
    return result;
  }, [controller.recordings]);
  const shown_channels = controller.channels
    .filter((channel) => channel.title.toLowerCase().includes(query.toLowerCase()))
    .sort((left, right) => {
      const a = summaries.get(left.id)?.latest;
      const b = summaries.get(right.id)?.latest;
      return (
        (b?.started_at ?? b?.created_at ?? '').localeCompare(
          a?.started_at ?? a?.created_at ?? '',
        ) || left.title.localeCompare(right.title)
      );
    });
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
  const createChannel = () => {
    if (!controller.busy && channel_name.trim()) void controller.createChannel(channel_name.trim());
  };
  const closeCreate = () => {
    setCreating(false);
    setChannelName('');
  };
  return (
    <aside className="library" aria-label={channel_mode ? 'Channels' : 'Documents'}>
      <div className="library-heading">
        <div>
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
        <div className="new-channel-form" role="form" aria-label="Create channel">
          <label>
            <span>Channel name</span>
            <input
              autoFocus
              value={channel_name}
              onChange={(event) => setChannelName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  createChannel();
                }
              }}
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
              onClick={createChannel}
              disabled={controller.busy || !channel_name.trim()}
            >
              Create channel
            </button>
          </div>
        </div>
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
              const summary = summaries.get(channel.id);
              const latest = summary?.latest;
              const date = latest ? new Date(latest.started_at ?? latest.created_at) : null;
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
                        {latest ? (
                          <>
                            <Icon name="mic" size={13} />
                            <span>{latest.transcript?.text || transcriptionLabel(latest)}</span>
                          </>
                        ) : (
                          'No voice notes yet'
                        )}
                      </span>
                      <span
                        className="channel-note-count"
                        aria-label={`${summary?.count ?? 0} voice notes`}
                      >
                        {summary?.count ?? 0} {summary?.count === 1 ? 'note' : 'notes'}
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
                  : 'Create a channel to keep your voice notes together.'}
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
