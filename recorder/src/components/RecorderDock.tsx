import { useLayoutEffect, useRef } from 'react';
import type { RecorderController } from '../lib/useRecorder';
import { formatTime } from '../lib/recordings';
import { Icon } from './Icon';

export function RecorderDock({
  controller,
  locked,
}: {
  controller: RecorderController;
  locked: boolean;
}) {
  const active = controller.audio.recording_state !== 'idle';
  const paused = controller.audio.recording_state === 'paused';
  const target = controller.active_capture;
  const channel_mode = (target?.mode ?? controller.mode) === 'clip';
  const channel_id = target?.channel_id ?? controller.selected_channel_id;
  const channel = controller.channels.find((entry) => entry.id === channel_id);
  const missing_channel = channel_mode && !channel;
  const destination = channel_mode ? (channel?.title ?? 'a channel') : 'a new document';
  const compose = channel_mode && channel && !active;
  const text = channel ? (controller.text_drafts.get(channel.id) ?? '') : '';
  const sendText = () => {
    if (channel && !locked && text.trim()) void controller.sendTextNote(channel.id);
  };
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const input = field.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight + 2}px`;
  }, [text, compose]);
  const label = (
    <div className={`dock-label ${channel_mode ? 'composer-copy' : ''}`}>
      {(!channel_mode || active) && (
        <span className={`dock-dot ${active && !paused ? 'pulsing' : ''}`} />
      )}
      <div>
        <strong>
          {active
            ? paused
              ? 'Recording paused'
              : 'Recording…'
            : channel_mode
              ? 'Choose a channel'
              : 'New document'}
        </strong>
        <span>
          {active
            ? `Saving to ${channel_mode ? '# ' : ''}${destination} · Keep Apell open`
            : channel_mode
              ? 'Open a channel to add a note'
              : !controller.platform?.native
                ? 'Transcription in Apell'
                : 'Save locally, then transcribe when ready'}
        </span>
      </div>
    </div>
  );
  const import_button = (
    <button
      className={`icon-button dock-import ${channel_mode ? 'composer-attachment' : ''}`}
      aria-label="Import audio"
      title="Import audio"
      disabled={!controller.capabilities.import || locked || missing_channel}
      onClick={() => void controller.importAudio()}
    >
      <Icon name={channel_mode ? 'plus' : 'upload'} size={channel_mode ? 23 : 20} />
    </button>
  );
  const record_button = (
    <button
      className={`record-button ${channel_mode ? 'composer-record' : ''}`}
      type="button"
      aria-label={
        controller.busy ? 'Please wait…' : channel_mode ? 'Record note' : 'Record document'
      }
      title={channel_mode ? 'Record note' : undefined}
      disabled={!controller.capabilities.recording || locked || missing_channel}
      onClick={() => void controller.start()}
    >
      {channel_mode ? <Icon name="mic" size={23} /> : <span className="record-button-dot" />}
      {!channel_mode && (controller.busy ? 'Please wait…' : 'Record document')}
    </button>
  );
  return (
    <section
      className={`recording-dock ${channel_mode ? 'channel-composer' : 'document-composer'} ${active ? 'is-recording' : ''}`}
      aria-label={channel_mode ? 'Channel composer' : 'Recording controls'}
    >
      {channel_mode && !active && import_button}
      {compose ? (
        <form
          className="channel-text-composer"
          onSubmit={(event) => {
            event.preventDefault();
            sendText();
          }}
        >
          <textarea
            ref={field}
            aria-label={`Text note to ${channel.title}`}
            placeholder="Write a note…"
            rows={1}
            value={text}
            enterKeyHint="send"
            readOnly={locked}
            onChange={(event) => controller.setTextDraft(channel.id, event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                event.nativeEvent.keyCode !== 229
              ) {
                event.preventDefault();
                sendText();
              }
            }}
          />
          {text.trim() ? (
            <button
              className="icon-button composer-send"
              type="submit"
              aria-label="Send text note"
              title="Send text note"
              disabled={locked}
              onMouseDown={(event) => event.preventDefault()}
            >
              <Icon name="send" size={23} />
            </button>
          ) : (
            record_button
          )}
        </form>
      ) : (
        label
      )}
      {active ? (
        <div className="active-controls">
          <span className="recording-clock" aria-label="Recorded duration">
            {formatTime(controller.audio.elapsed_ms)}
          </span>
          <button
            className="icon-button pause-recording"
            disabled={controller.busy}
            aria-label={paused ? 'Resume recording' : 'Pause recording'}
            onClick={() => void controller.pause()}
          >
            <Icon name={paused ? 'play' : 'pause'} size={23} />
          </button>
          <button
            className="button stop-recording"
            disabled={controller.busy}
            onClick={() => void controller.stop()}
          >
            <Icon name="stop" size={18} />
            {controller.busy ? 'Saving…' : channel_mode ? 'Save note' : 'Save document'}
          </button>
        </div>
      ) : compose ? null : channel_mode ? (
        record_button
      ) : (
        <div className="dock-actions">
          {import_button}
          {record_button}
        </div>
      )}
    </section>
  );
}
