import { useEffect, useState } from 'react';
import type { RecorderController } from '../lib/useRecorder';
import type { Recording } from '../lib/types';
import { formatBytes, formatTime, languageName } from '../lib/recordings';
import { Icon } from './Icon';

const languages = [
  ['', 'Detect automatically'],
  ['en', 'English'],
  ['zh', 'Chinese'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['ar', 'Arabic'],
  ['ru', 'Russian'],
  ['pt', 'Portuguese'],
  ['it', 'Italian'],
  ['hi', 'Hindi'],
];

export function RecordingDetail({
  recording,
  controller,
  onBack,
  onModel,
  onDirtyChange,
}: {
  recording: Recording;
  controller: RecorderController;
  onBack: () => void;
  onModel: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [title, setTitle] = useState(recording.title);
  const [text, setText] = useState(recording.transcript?.text ?? '');
  const [editing, setEditing] = useState(false);
  const [language, setLanguage] = useState('');
  const [confirm_delete, setConfirmDelete] = useState(false);
  const [confirm_retranscribe, setConfirmRetranscribe] = useState(false);
  const [seek_ms, setSeekMs] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const dirty = title !== recording.title || text !== (recording.transcript?.text ?? '');
  const transcribing = controller.job === recording.id;
  const is_playing = controller.playing_id === recording.id && controller.audio.playing;
  const position_ms = controller.playing_id === recording.id ? controller.audio.position_ms : 0;
  const duration_ms =
    recording.duration_ms ||
    (controller.playing_id === recording.id ? controller.audio.duration_ms : 0);
  const recording_active = controller.audio.recording_state !== 'idle';

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    setText(recording.transcript?.text ?? '');
    setTitle(recording.title);
  }, [recording.transcript, recording.title]);

  const save = async () => {
    await controller.save({
      ...recording,
      title: title.trim() || 'Untitled recording',
      transcript: recording.transcript ? { ...recording.transcript, text } : null,
      transcript_edited: recording.transcript_edited || text !== (recording.transcript?.text ?? ''),
    });
  };
  const discard = () => {
    setTitle(recording.title);
    setText(recording.transcript?.text ?? '');
    setEditing(false);
  };
  const transcribe = () => {
    setConfirmRetranscribe(false);
    void controller.transcribe(recording, language || undefined);
  };
  const seek = async (position: number) => {
    await controller.seek(recording, position);
    setSeeking(false);
  };

  return (
    <section className="detail" aria-label="Recording details">
      <div className="detail-topline">
        <button className="text-button back-button" onClick={onBack}>
          <Icon name="back" size={17} />
          All recordings
        </button>
        <span className="eyebrow">
          {recording.source === 'import' ? 'Imported audio' : 'Voice recording'}
        </span>
        <button
          className="icon-button delete-button"
          aria-label="Delete recording"
          disabled={controller.busy || transcribing || dirty || recording_active}
          onClick={() => setConfirmDelete(true)}
        >
          <Icon name="trash" size={19} />
        </button>
      </div>
      <label className="title-label">
        <span className="sr-only">Recording title</span>
        <input
          className="detail-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={transcribing}
          maxLength={160}
        />
      </label>
      <div className="detail-meta">
        <span>
          {new Date(recording.created_at).toLocaleDateString(undefined, {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          })}
        </span>
        <span>
          {new Date(recording.created_at).toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit',
          })}
        </span>
        <span>{formatBytes(recording.size_bytes)}</span>
      </div>
      <div className="player">
        <button
          className="play-button"
          aria-label={is_playing ? 'Pause playback' : 'Play recording'}
          disabled={!controller.capabilities.playback || controller.busy || recording_active}
          onClick={() => void controller.play(recording)}
        >
          <Icon name={is_playing ? 'pause' : 'play'} size={22} />
        </button>
        <div className="player-track">
          <input
            aria-label="Playback position"
            type="range"
            min="0"
            max={Math.max(duration_ms, 1)}
            step="100"
            value={Math.min(seeking ? seek_ms : position_ms, duration_ms)}
            disabled={
              !controller.capabilities.playback ||
              controller.busy ||
              duration_ms === 0 ||
              recording_active
            }
            onChange={(event) => {
              setSeekMs(Number(event.target.value));
              setSeeking(true);
            }}
            onPointerUp={(event) => void seek(Number(event.currentTarget.value))}
            onKeyUp={(event) => {
              if (
                [
                  'ArrowLeft',
                  'ArrowRight',
                  'ArrowUp',
                  'ArrowDown',
                  'Home',
                  'End',
                  'PageUp',
                  'PageDown',
                ].includes(event.key)
              )
                void seek(Number(event.currentTarget.value));
            }}
            onBlur={() => {
              if (seeking) void seek(seek_ms);
            }}
          />
          <div className="player-time">
            <span>{formatTime(seeking ? seek_ms : position_ms)}</span>
            <span>{formatTime(duration_ms)}</span>
          </div>
        </div>
        <button
          className="icon-button"
          aria-label="Share audio"
          disabled={!controller.capabilities.sharing || controller.busy}
          onClick={() => void controller.shareAudio(recording)}
        >
          <Icon name="share" />
        </button>
      </div>
      <div className="transcript-header">
        <div className="section-heading">
          <Icon name="text" />
          <h2>Transcript</h2>
          {recording.transcript && (
            <span className="language-chip">
              <Icon name="globe" size={13} />
              {languageName(recording.transcript.language)}
            </span>
          )}
        </div>
        {recording.transcript && (
          <div className="inline-actions">
            <button
              className="icon-button"
              aria-label={editing ? 'View transcript' : 'Edit transcript'}
              disabled={transcribing}
              onClick={() => setEditing(!editing)}
            >
              <Icon name={editing ? 'check' : 'edit'} size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="Share transcript"
              disabled={!controller.capabilities.sharing || controller.busy || dirty}
              onClick={() => void controller.shareTranscript(recording)}
            >
              <Icon name="share" size={17} />
            </button>
          </div>
        )}
      </div>
      {transcribing ? (
        <div className="transcribing-panel" role="status">
          <span className="spinner" />
          <h3>Listening, on this device</h3>
          <p>
            {controller.speech.stage === 'decoding'
              ? 'Preparing your audio…'
              : 'Turning your recording into words.'}
          </p>
          <progress max="100" value={Math.max(0, Math.min(100, controller.speech.progress))} />
          <button
            className="text-button"
            onClick={() => void controller.cancelSpeech()}
            disabled={controller.busy}
          >
            Cancel transcription
          </button>
        </div>
      ) : recording.transcript ? (
        <div className="transcript-content">
          {editing ? (
            <label>
              <span className="sr-only">Transcript text</span>
              <textarea
                className="transcript-editor"
                value={text}
                onChange={(event) => setText(event.target.value)}
                spellCheck
              />
            </label>
          ) : (
            <p className="transcript-prose">
              {text || <span className="muted">No speech was detected in this recording.</span>}
            </p>
          )}
          <p className="transcript-footnote">
            {recording.transcript_edited ? 'Edited transcript' : 'Transcribed on device'} · Review
            names and important details.
          </p>
        </div>
      ) : (
        <div className="empty-transcript">
          <div className="empty-transcript-icon">
            <Icon name="text" size={29} />
          </div>
          <h3>Your words, written down.</h3>
          <p>
            Transcribe this recording and detect its language.
            <br />
            Your audio stays on this device.
          </p>
        </div>
      )}
      {dirty && (
        <div className="save-bar">
          <span>Unsaved changes</span>
          <button className="text-button" onClick={discard} disabled={controller.busy}>
            Discard
          </button>
          <button
            className="button button-dark button-small"
            onClick={() => void save()}
            disabled={controller.busy || transcribing}
          >
            Save changes
          </button>
        </div>
      )}
      {!transcribing && (
        <div className="transcription-controls">
          <label className="language-select">
            <span>Spoken language</span>
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              disabled={Boolean(controller.job) || dirty}
            >
              {languages.map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {!controller.platform?.native ? (
            <p className="preview-note">Open this applet in Apell for on-device transcription.</p>
          ) : !controller.speech.model_ready ? (
            <button className="button button-dark" onClick={onModel}>
              <Icon name="download" size={18} />
              Set up transcription
            </button>
          ) : (
            <button
              className="button button-dark"
              disabled={
                Boolean(controller.job) ||
                controller.speech.busy ||
                dirty ||
                controller.busy ||
                recording_active
              }
              onClick={() => (recording.transcript ? setConfirmRetranscribe(true) : transcribe())}
            >
              <Icon name="wave" size={18} />
              {recording.transcript ? 'Transcribe again' : 'Transcribe recording'}
            </button>
          )}
        </div>
      )}
      {confirm_delete && (
        <div className="inline-confirm" role="alert">
          <strong>Delete this recording?</strong>
          <p>The audio and transcript will be removed from this device.</p>
          <div>
            <button
              className="button button-small"
              onClick={() => setConfirmDelete(false)}
              disabled={controller.busy}
            >
              Keep recording
            </button>
            <button
              className="button button-danger button-small"
              onClick={() => void controller.remove(recording)}
              disabled={controller.busy}
            >
              Delete recording
            </button>
          </div>
        </div>
      )}
      {confirm_retranscribe && (
        <div className="inline-confirm" role="alert">
          <strong>Replace the current transcript?</strong>
          <p>A new transcription will replace its text, including your edits.</p>
          <div>
            <button className="button button-small" onClick={() => setConfirmRetranscribe(false)}>
              Keep transcript
            </button>
            <button className="button button-dark button-small" onClick={transcribe}>
              Replace transcript
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
