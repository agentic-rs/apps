import { useEffect, useRef } from 'react';
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
  const dock = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = dock.current;
    if (!element) return;
    const measure = () =>
      element
        .closest<HTMLElement>('.app')
        ?.style.setProperty('--dock-height', `${element.offsetHeight}px`);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);
  const active = controller.audio.recording_state !== 'idle';
  const paused = controller.audio.recording_state === 'paused';
  const target = controller.active_capture;
  const channel_mode = (target?.mode ?? controller.mode) === 'clip';
  const channel_id = target?.channel_id ?? controller.selected_channel_id;
  const channel = controller.channels.find((entry) => entry.id === channel_id);
  const missing_channel = controller.mode === 'clip' && !controller.selected_channel_id;
  const destination = channel_mode
    ? channel
      ? `# ${channel.title}`
      : 'a channel'
    : 'a new document';
  return (
    <section
      ref={dock}
      className={`recording-dock ${active ? 'is-recording' : ''}`}
      aria-label="Recording controls"
    >
      <div className="dock-label">
        <span className={`dock-dot ${active && !paused ? 'pulsing' : ''}`} />
        <div>
          <strong>
            {active
              ? paused
                ? 'Recording paused'
                : 'Recording in progress'
              : missing_channel
                ? 'Choose a channel to begin'
                : channel_mode
                  ? `A quick thought for ${destination}`
                  : 'Space for the whole conversation'}
          </strong>
          <span>
            {active
              ? `Saving to ${destination} · Keep Apell open`
              : missing_channel
                ? 'Create a channel, or open one from your collection'
                : !controller.platform?.native
                  ? 'Saves in this browser · Transcription in Apell'
                  : channel_mode
                    ? 'Saves locally and transcribes automatically'
                    : 'Save locally, then transcribe when ready'}
          </span>
        </div>
      </div>
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
      ) : (
        <div className="dock-actions">
          <button
            className="icon-button dock-import"
            aria-label="Import audio"
            title="Import audio"
            disabled={!controller.capabilities.import || locked || missing_channel}
            onClick={() => void controller.importAudio()}
          >
            <Icon name="upload" size={20} />
          </button>
          <button
            className="record-button"
            disabled={!controller.capabilities.recording || locked || missing_channel}
            onClick={() => void controller.start()}
          >
            <span className="record-button-dot" />
            {controller.busy ? 'Please wait…' : channel_mode ? 'Record note' : 'Record document'}
          </button>
        </div>
      )}
    </section>
  );
}
