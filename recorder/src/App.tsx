import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './components/Icon';
import { RecordingDetail } from './components/RecordingDetail';
import { formatBytes, formatTime, languageName } from './lib/recordings';
import { useRecorder } from './lib/useRecorder';

export function App() {
  const controller = useRecorder();
  const native = controller.platform?.native ?? window.parent !== window;
  const [query, setQuery] = useState('');
  const [model_open, setModelOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const model_dialog = useRef<HTMLDialogElement>(null);
  const selected = controller.recordings.find(
    (recording) => recording.id === controller.selected_id,
  );
  const recording_active = controller.audio.recording_state !== 'idle';
  const paused = controller.audio.recording_state === 'paused';
  const locked =
    controller.loading || controller.busy || Boolean(controller.pending_recording) || dirty;
  const filtered = controller.recordings.filter((recording) =>
    `${recording.title} ${recording.transcript?.text ?? ''}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const total_duration = controller.recordings.reduce(
    (total, recording) => total + recording.duration_ms,
    0,
  );
  const onDirtyChange = useCallback((value: boolean) => setDirty(value), []);
  const selectRecording = (id: string | null) => {
    if (dirty) {
      controller.setError('Save or discard your changes before opening another recording.');
      return;
    }
    controller.setSelectedId(id);
  };

  useEffect(() => {
    const dialog = model_dialog.current;
    if (!dialog) return;
    if (model_open && !dialog.open) dialog.showModal();
    if (!model_open && dialog.open) dialog.close();
  }, [model_open]);

  return (
    <div className="app-scroll">
      <div className={`app ${native ? 'native-app' : ''} ${selected ? 'has-selection' : ''}`}>
        <header className="app-header">
          <div className="brand">
            <span className="brand-mark">
              <Icon name="wave" size={23} />
            </span>
            <div>
              <h1>Recorder</h1>
              <span className="brand-caption">A little room for your thoughts.</span>
            </div>
          </div>
          <button
            className={`model-status ${controller.speech.model_ready ? 'model-ready' : ''}`}
            onClick={() => setModelOpen(true)}
            aria-label="Transcription settings"
          >
            <span className="status-dot" />
            {controller.job === 'download'
              ? 'Setting up…'
              : controller.speech.model_ready
                ? 'Offline ready'
                : 'On-device transcription'}
            <Icon name="settings" size={15} />
          </button>
        </header>
        {!controller.platform?.native && !controller.loading && (
          <div className="browser-banner">
            <Icon name="globe" size={16} />
            <span>
              Local browser preview · Recordings stay in this browser. Transcription is available in
              Apell.
            </span>
          </div>
        )}
        {(controller.error || controller.notice) && (
          <div
            className={`message-bar ${controller.error ? 'message-error' : 'message-success'}`}
            role={controller.error ? 'alert' : 'status'}
          >
            <span>{controller.error || controller.notice}</span>
            {controller.error && (
              <div className="inline-actions">
                <button
                  className="text-button"
                  onClick={() => void controller.reload()}
                  disabled={
                    controller.busy ||
                    recording_active ||
                    Boolean(controller.pending_recording) ||
                    dirty
                  }
                >
                  Retry connection
                </button>
                <button
                  className="icon-button"
                  aria-label="Dismiss error"
                  onClick={() => controller.setError('')}
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
            )}
          </div>
        )}
        {controller.pending_recording && (
          <div className="recovery-bar" role="alert">
            <div>
              <strong>Your recording is waiting to be saved.</strong>
              <p>Keep this screen open and retry after checking available storage.</p>
            </div>
            <button
              className="button button-dark button-small"
              disabled={controller.busy || dirty}
              onClick={() => void controller.retrySave()}
            >
              Retry save
            </button>
          </div>
        )}
        <main className="workspace">
          <aside className="library" aria-label="Recording library">
            <div className="library-heading">
              <div>
                <p className="eyebrow">Your collection</p>
                <h2>
                  All recordings <span>{controller.recordings.length}</span>
                </h2>
              </div>
              <button
                className="icon-button import-button"
                aria-label="Import audio"
                title="Import audio"
                disabled={!controller.capabilities.import || locked || recording_active}
                onClick={() => void controller.importAudio()}
              >
                <Icon name="upload" />
              </button>
            </div>
            <label className="search">
              <Icon name="search" size={17} />
              <span className="sr-only">Search recordings and transcripts</span>
              <input
                type="search"
                placeholder="Search your recordings"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="recording-list">
              {controller.loading ? (
                <div className="library-empty" role="status">
                  <span className="spinner" />
                  <p>Opening your recordings…</p>
                </div>
              ) : filtered.length ? (
                filtered.map((recording) => (
                  <button
                    key={recording.id}
                    className={`recording-item ${selected?.id === recording.id ? 'selected' : ''}`}
                    onClick={() => selectRecording(recording.id)}
                    aria-current={selected?.id === recording.id ? 'true' : undefined}
                  >
                    <span className="recording-art">
                      <Icon name="wave" size={22} />
                    </span>
                    <span className="recording-summary">
                      <span className="recording-title">{recording.title}</span>
                      <span className="recording-date">
                        {new Date(recording.created_at).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })}
                        <span>·</span>
                        {formatTime(recording.duration_ms)}
                      </span>
                      <span
                        className={`recording-label ${recording.transcript ? 'has-transcript' : ''}`}
                      >
                        {controller.job === recording.id
                          ? 'Transcribing…'
                          : recording.transcript
                            ? `${languageName(recording.transcript.language)} · Transcribed`
                            : 'Audio only'}
                      </span>
                    </span>
                  </button>
                ))
              ) : (
                <div className="library-empty">
                  <Icon name={query ? 'search' : 'mic'} size={30} />
                  <h3>{query ? 'Nothing found' : 'A fresh start'}</h3>
                  <p>
                    {query
                      ? 'Try a different title or a word from a transcript.'
                      : 'Your voice notes, conversations, and imported audio will appear here.'}
                  </p>
                </div>
              )}
            </div>
            <div className="library-footer">
              <Icon name="lock" size={14} />
              <span>Stored on this device</span>
              {controller.recordings.length > 0 && (
                <span className="total-time">{formatTime(total_duration)} total</span>
              )}
            </div>
          </aside>
          {selected ? (
            <RecordingDetail
              key={selected.id}
              recording={selected}
              controller={controller}
              onBack={() => selectRecording(null)}
              onModel={() => setModelOpen(true)}
              onDirtyChange={onDirtyChange}
            />
          ) : (
            <section className="welcome">
              <div className="welcome-orbit">
                <span />
                <span />
                <div>
                  <Icon name="mic" size={49} />
                </div>
              </div>
              <p className="eyebrow">Make space for a thought</p>
              <h2>
                Some things are
                <br />
                better said aloud.
              </h2>
              <p>
                Capture an idea. Keep a conversation.
                <br />
                Find the words again, whenever you need them.
              </p>
              <button
                className="text-button welcome-import"
                disabled={!controller.capabilities.import || locked || recording_active}
                onClick={() => void controller.importAudio()}
              >
                <Icon name="upload" size={17} />
                Or import an audio file
              </button>
              <div className="privacy-note">
                <Icon name="lock" size={14} />
                Private by design. Transcribed on device.
              </div>
            </section>
          )}
        </main>
        <section
          className={`recording-dock ${recording_active ? 'is-recording' : ''}`}
          aria-label="Recording controls"
        >
          <div className="dock-label">
            <span className={`dock-dot ${recording_active && !paused ? 'pulsing' : ''}`} />
            <div>
              <strong>
                {recording_active
                  ? paused
                    ? 'Take your time'
                    : 'Recording in progress'
                  : 'Ready when you are'}
              </strong>
              <span>
                {recording_active
                  ? paused
                    ? 'Recording is paused'
                    : 'Keep Apell open while recording'
                  : 'Tap to capture something worth keeping'}
              </span>
            </div>
          </div>
          {recording_active ? (
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
                {controller.busy ? 'Saving…' : 'Save recording'}
              </button>
            </div>
          ) : (
            <button
              className="record-button"
              disabled={!controller.capabilities.recording || locked}
              onClick={() => void controller.start()}
            >
              <span className="record-button-dot" />
              {controller.busy ? 'Please wait…' : 'Record'}
            </button>
          )}
        </section>
        <dialog
          ref={model_dialog}
          className="model-dialog"
          onCancel={() => setModelOpen(false)}
          onClose={() => setModelOpen(false)}
          aria-labelledby="model-title"
        >
          <button
            className="icon-button dialog-close"
            aria-label="Close transcription settings"
            onClick={() => setModelOpen(false)}
          >
            <Icon name="close" />
          </button>
          <div className="model-icon">
            <Icon name="globe" size={31} />
          </div>
          <p className="eyebrow">Words without the cloud</p>
          <h2 id="model-title">On-device transcription</h2>
          <p className="model-description">
            A multilingual Whisper model turns audio into text and detects its spoken language.
            Audio is processed locally and never uploaded.
          </p>
          <div className="model-card">
            <div>
              <strong>Whisper Tiny · Multilingual</strong>
              <p>
                {controller.speech.model_size_bytes
                  ? formatBytes(controller.speech.model_size_bytes)
                  : 'About 75 MB'}{' '}
                · One-time download
              </p>
            </div>
            {controller.speech.model_ready ? (
              <span className="ready-badge">
                <Icon name="check" size={15} />
                Ready
              </span>
            ) : (
              <Icon name="download" size={22} />
            )}
          </div>
          {!controller.platform?.native ? (
            <p className="preview-note">
              Install this applet in the updated Apell mobile host to download and run the model.
              The browser preview supports recording, import, playback, and export.
            </p>
          ) : controller.job === 'download' || controller.speech.stage === 'downloading' ? (
            <div className="download-progress" role="status">
              <div>
                <span>Downloading model…</span>
                <span>{Math.round(controller.speech.progress)}%</span>
              </div>
              <progress max="100" value={Math.max(0, Math.min(100, controller.speech.progress))} />
              <button
                className="text-button"
                onClick={() => void controller.cancelSpeech()}
                disabled={controller.busy}
              >
                Cancel download
              </button>
            </div>
          ) : controller.speech.model_ready ? (
            <p className="model-ready-note">
              <Icon name="check" size={16} />
              Ready to transcribe, even without an internet connection.
            </p>
          ) : (
            <button
              className="button button-dark model-download"
              disabled={Boolean(controller.job) || controller.speech.busy || controller.busy}
              onClick={() => void controller.downloadModel()}
            >
              <Icon name="download" size={18} />
              Download language model
            </button>
          )}
          <p className="model-footnote">
            Transcribe files up to 30 minutes long. Supported formats: WAV, MP3, M4A/AAC, FLAC, and
            Ogg/Vorbis. WebM and Opus are not supported. Automatic language detection works best
            with clear speech; review names and short clips.
          </p>
        </dialog>
      </div>
    </div>
  );
}
