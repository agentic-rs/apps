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
            : missing_channel
              ? 'Choose a channel'
              : channel_mode
                ? `Voice note to ${destination}`
                : 'Space for the whole conversation'}
        </strong>
        <span>
          {active
            ? `Saving to ${channel_mode ? '# ' : ''}${destination} · Keep Apell open`
            : missing_channel
              ? 'Open a channel to record'
              : !controller.platform?.native
                ? 'Transcription in Apell'
                : channel_mode
                  ? 'Transcribes automatically'
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
      aria-label="Recording controls"
    >
      {channel_mode && !active && import_button}
      {label}
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
      ) : channel_mode ? (
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
