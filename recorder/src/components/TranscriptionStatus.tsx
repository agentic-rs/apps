import { useState } from 'react';
import type { Recording } from '../lib/types';
import type { RecorderController } from '../lib/useRecorder';
import { languageName } from '../lib/recordings';
import { Icon } from './Icon';

export function transcriptionLabel(recording: Recording): string {
  switch (recording.transcription_state) {
    case 'queued':
      return 'Queued for transcription';
    case 'running':
      return 'Transcribing…';
    case 'failed':
      return 'Transcription needs attention';
    case 'cancelled':
      return 'Transcription cancelled';
    case 'complete':
      return recording.transcript
        ? recording.transcript.language === 'und'
          ? 'Written notes'
          : `${languageName(recording.transcript.language)} · Transcribed`
        : 'Transcription complete';
    default:
      return recording.transcript ? 'Transcribed' : 'Audio only';
  }
}

export function TranscriptionStatus({
  recording,
  controller,
  onModel,
  dirty = false,
  compact = false,
  expanded = true,
}: {
  recording: Recording;
  controller: RecorderController;
  onModel: () => void;
  dirty?: boolean;
  compact?: boolean;
  expanded?: boolean;
}) {
  const [language, setLanguage] = useState('');
  const [confirm_replace, setConfirmReplace] = useState(false);
  const queued = recording.transcription_state === 'queued';
  const running = recording.transcription_state === 'running' || controller.job === recording.id;
  const failed = recording.transcription_state === 'failed';
  const cancelled = recording.transcription_state === 'cancelled';
  const active = queued || running;
  const transcribe = () => {
    setConfirmReplace(false);
    void controller.transcribe(recording, language || undefined);
  };
  const status = running
    ? 'Transcribing on this device'
    : queued
      ? !controller.platform?.native
        ? 'Transcription is available in Apell'
        : !controller.speech.model_ready
          ? 'Waiting for the language model'
          : 'Queued for transcription'
      : failed
        ? 'Could not transcribe this recording'
        : cancelled
          ? 'Transcription cancelled'
          : '';
  return (
    <div className={`transcription-status ${compact ? 'transcription-compact' : ''}`}>
      {status && (
        <div className={`queue-status ${failed ? 'queue-error' : ''}`} role="status">
          <div className="queue-status-line">
            {running ? (
              <span className="spinner" />
            ) : (
              <Icon name={failed ? 'text' : 'wave'} size={17} />
            )}
            <strong>{status}</strong>
            {active && (
              <button
                className="text-button"
                disabled={controller.busy}
                onClick={() => void controller.cancelTranscription(recording)}
              >
                Cancel
              </button>
            )}
          </div>
          {running && (
            <progress
              max="100"
              value={
                controller.job === recording.id
                  ? Math.max(0, Math.min(100, controller.speech.progress))
                  : 0
              }
            />
          )}
          {queued && !compact && (
            <p>
              {!controller.platform?.native
                ? 'Open the applet in Apell for on-device transcription.'
                : !controller.speech.model_ready
                  ? 'Download the model once. Saved recordings will then transcribe automatically.'
                  : 'This recording will start when the current job finishes. You can keep recording.'}
            </p>
          )}
          {failed && (
            <p>
              {recording.transcription_error || 'Your audio is safe. Try again when you are ready.'}
            </p>
          )}
        </div>
      )}
      {!controller.platform?.native ? (
        !compact && <p className="preview-note">On-device transcription is available in Apell.</p>
      ) : !controller.speech.model_ready ? (
        <button className="text-button setup-link" onClick={onModel}>
          <Icon name="download" size={15} />
          Set up on-device transcription
        </button>
      ) : (
        !active &&
        (!compact || expanded || failed || cancelled || !recording.transcript) && (
          <div className="transcription-actions">
            {!compact && (
              <label className="language-select">
                <span>Spoken language</span>
                <select
                  value={language}
                  onChange={(event) => setLanguage(event.target.value)}
                  disabled={dirty || controller.busy}
                >
                  <option value="">Detect automatically</option>
                  {[
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
                  ].map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              className="text-button"
              disabled={dirty || controller.busy || Boolean(controller.pending_recording)}
              onClick={() => (recording.transcript ? setConfirmReplace(true) : transcribe())}
            >
              <Icon name="wave" size={15} />
              {recording.transcript
                ? 'Transcribe again'
                : failed
                  ? 'Retry transcription'
                  : 'Transcribe'}
            </button>
          </div>
        )
      )}
      {confirm_replace && (
        <div className="inline-confirm" role="alert">
          <strong>Replace this transcript?</strong>
          <p>A new transcription will replace the saved text, including edits.</p>
          <div>
            <button className="button button-small" onClick={() => setConfirmReplace(false)}>
              Keep text
            </button>
            <button className="button button-dark button-small" onClick={transcribe}>
              Replace transcript
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
