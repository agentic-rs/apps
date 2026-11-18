import { useRef, useState } from 'react';
import type { RecorderController } from '../lib/useRecorder';
import type { SpeechSettings } from '../lib/types';
import { errorMessage } from '../lib/library';
import { formatBytes } from '../lib/recordings';
import { Icon } from './Icon';
import { ActionDialog } from './ActionDialog';

function providerLabel(name: string, available: boolean | undefined, native: boolean) {
  if (available) return name;
  if (native && available === undefined) return `${name} · update Apell`;
  return `${name} · unavailable`;
}

export function ModelDialog({
  controller,
  onClose,
}: {
  controller: RecorderController;
  onClose: () => void;
}) {
  const { speech, speech_settings } = controller;
  const [provider, setProvider] = useState(speech_settings.provider);
  const [api, setApi] = useState<Extract<SpeechSettings, { provider: 'api' }> | null>(
    speech_settings.provider === 'api' ? speech_settings : null,
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const requesting = useRef(false);
  const native = controller.platform?.native === true;
  const withSettings = async (action: () => Promise<void>) => {
    if (requesting.current) return;
    requesting.current = true;
    setSaving(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      requesting.current = false;
      setSaving(false);
    }
  };
  const downloading = controller.job === 'download' || speech.stage === 'downloading';
  const selected = provider === 'api' ? api : { provider };
  const changed =
    selected &&
    (provider !== speech_settings.provider ||
      (api &&
        provider === 'api' &&
        speech_settings.provider === 'api' &&
        (api.connection_id !== speech_settings.connection_id ||
          api.model_id !== speech_settings.model_id)));
  return (
    <ActionDialog
      title="Transcription"
      className="model-dialog"
      onCancel={() => {
        if (!saving) onClose();
      }}
    >
      <button
        className="icon-button dialog-close"
        aria-label="Close transcription settings"
        disabled={saving}
        onClick={onClose}
      >
        <Icon name="close" />
      </button>
      <label className="language-select speech-provider">
        <span>Speech recognition</span>
        <select
          value={provider}
          disabled={!native || saving || downloading}
          onChange={(event) => {
            setProvider(event.target.value as SpeechSettings['provider']);
            setError('');
          }}
        >
          <option value="system" disabled={!speech.system_available}>
            {providerLabel('System recognizer', speech.system_available, native)}
          </option>
          <option value="downloaded">Downloaded model</option>
          <option value="api" disabled={!speech.api_available}>
            {providerLabel('Transcription API', speech.api_available, native)}
          </option>
        </select>
      </label>
      {native && !speech.system_available && speech.system_unavailable_reason && (
        <p className="model-footnote">{speech.system_unavailable_reason}</p>
      )}
      {native && speech.api_available === false && (
        <p className="model-footnote">
          API transcription requires a Recorder package with network and model-provider access.
        </p>
      )}
      {!native ? (
        <p className="model-description">Open Recorder in Apell to choose a speech recognizer.</p>
      ) : provider === 'downloaded' ? (
        <>
          <div className="model-card">
            <div>
              <strong>Whisper Tiny · Multilingual</strong>
              <p>
                {speech.model_size_bytes ? formatBytes(speech.model_size_bytes) : 'About 75 MB'} ·
                On this device
              </p>
            </div>
            {speech.model_ready && (
              <span className="ready-badge">
                <Icon name="check" size={15} />
                Ready
              </span>
            )}
          </div>
          {downloading ? (
            <div className="download-progress" role="status">
              <div>
                <span>Downloading model…</span>
                <span>{Math.round(speech.progress)}%</span>
              </div>
              <progress max="100" value={Math.max(0, Math.min(100, speech.progress))} />
              <button className="text-button" onClick={controller.cancelModelDownload}>
                Cancel download
              </button>
            </div>
          ) : (
            !speech.model_ready && (
              <button
                className="button button-dark model-download"
                disabled={Boolean(controller.job) || speech.busy}
                onClick={() => void controller.downloadModel()}
              >
                <Icon name="download" size={18} />
                Download model
              </button>
            )
          )}
          {controller.download_error && (
            <p className="speech-error" role="alert">
              {controller.download_error}
            </p>
          )}
        </>
      ) : provider === 'system' ? (
        <p className="model-description">
          Use your device’s speech recognizer. Recognition uses the device language unless you
          choose another language for a document. Availability depends on installed speech
          languages.
        </p>
      ) : (
        <>
          <p className="model-description">
            Queued recordings and new voice notes will be sent to the selected API for
            transcription. Choose an OpenAI or OpenAI-compatible connection and enter its
            transcription model ID. Files can be up to 25 MB.
          </p>
          <button
            className="button speech-target"
            disabled={saving}
            onClick={() =>
              void withSettings(async () => {
                const target = await controller.platform?.speechSettings?.chooseApi(
                  api ?? undefined,
                );
                if (target) setApi(target);
              })
            }
          >
            {api ? api.model_id + ' · Change' : 'Choose API model'}
          </button>
        </>
      )}
      {error && (
        <p className="speech-error" role="alert">
          {error}
        </p>
      )}
      {native && changed && selected && (
        <button
          className="button button-dark speech-apply"
          disabled={saving || downloading}
          onClick={() =>
            void withSettings(async () => {
              await controller.setSpeechSettings(selected);
              onClose();
            })
          }
        >
          {saving ? 'Saving…' : 'Use this recognizer'}
        </button>
      )}
    </ActionDialog>
  );
}
