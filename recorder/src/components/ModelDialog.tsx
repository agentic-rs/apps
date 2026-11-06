import { useEffect, useRef } from 'react';
import type { RecorderController } from '../lib/useRecorder';
import { formatBytes } from '../lib/recordings';
import { Icon } from './Icon';

export function ModelDialog({
  controller,
  open,
  onClose,
}: {
  controller: RecorderController;
  open: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  const queued = controller.recordings.filter(
    (recording) => recording.transcription_state === 'queued',
  ).length;
  return (
    <dialog
      ref={dialog}
      className="model-dialog"
      onCancel={onClose}
      onClose={onClose}
      aria-labelledby="model-title"
    >
      <button
        className="icon-button dialog-close"
        aria-label="Close transcription settings"
        onClick={onClose}
      >
        <Icon name="close" />
      </button>
      <div className="model-icon">
        <Icon name="globe" size={31} />
      </div>
      <p className="eyebrow">Words without the cloud</p>
      <h2 id="model-title">On-device transcription</h2>
      <p className="model-description">
        In Apell, channel notes transcribe automatically, one at a time. Start document
        transcription whenever you are ready. A multilingual Whisper model detects the spoken
        language. Your audio never leaves this device.
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
          The browser preview supports recording, channels, documents, playback, and export. Install
          this applet in the updated Apell mobile host for on-device transcription.
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
          {queued
            ? `${queued} ${queued === 1 ? 'recording is' : 'recordings are'} waiting to transcribe.`
            : 'Ready to transcribe, even without an internet connection.'}
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
        Recordings up to 3 hours are supported. Keep Apell open while transcribing. Supported
        formats: WAV, MP3, M4A/AAC, FLAC, and Ogg/Vorbis. WebM and Opus are not supported. Review
        names, numbers, and short clips for accuracy. Imports can be up to 2 GiB in Apell or 128 MiB
        in the browser preview.
      </p>
    </dialog>
  );
}
