import { ConfirmDialog } from './ConfirmDialog';
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
          ? recording.transcript.model_id
            ? 'Transcribed'
            : 'Written notes'
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
    ? 'Transcribing…'
    : queued
      ? !controller.platform?.native
        ? 'Transcription is available in Apell'
        : !controller.speech_ready
          ? 'Waiting for transcription setup'
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
                controller.job === recording.id && controller.speech.progress > 0
                  ? Math.max(0, Math.min(100, controller.speech.progress))
                  : undefined
              }
            />
          )}
          {queued && !compact && (
            <p>
              {!controller.platform?.native
                ? 'Open Recorder in Apell to transcribe.'
                : !controller.speech_ready
                  ? 'Choose an available recognizer in Settings to transcribe queued recordings.'
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
        !compact && <p className="preview-note">Transcription is available in Apell.</p>
      ) : !controller.speech_ready ? (
        <button className="text-button setup-link" onClick={onModel}>
          <Icon name="download" size={15} />
          Set up transcription
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
                  <option value="">
                    {controller.speech_provider === 'system'
                      ? 'Device language'
                      : 'Detect automatically'}
                  </option>
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
        <ConfirmDialog
          title="Replace this transcript?"
          description="A new transcription will replace the saved text, including your edits."
          confirm_label="Replace transcript"
          onCancel={() => setConfirmReplace(false)}
          onConfirm={transcribe}
        />
      )}
    </div>
  );
}
