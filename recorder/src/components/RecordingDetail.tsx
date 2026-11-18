import { ConfirmDialog } from './ConfirmDialog';
import { useEffect, useState } from 'react';
import type { RecorderController } from '../lib/useRecorder';
import type { Recording } from '../lib/types';
import { formatBytes, languageName } from '../lib/recordings';
import { AudioPlayer } from './AudioPlayer';
import { Icon } from './Icon';
import { TranscriptionStatus } from './TranscriptionStatus';
import { useRecordingDraft } from './useRecordingDraft';

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
  onDirtyChange: (id: string, dirty: boolean) => void;
}) {
  const draft = useRecordingDraft(recording, controller);
  const [confirm_delete, setConfirmDelete] = useState(false);
  const [writing, setWriting] = useState(false);
  const date = new Date(recording.started_at ?? recording.created_at);
  useEffect(() => {
    onDirtyChange(recording.id, draft.dirty);
  }, [recording.id, draft.dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(recording.id, false), [recording.id, onDirtyChange]);
  return (
    <section className="detail document-detail" aria-label="Document editor">
      <div className="detail-topline">
        <button className="text-button back-button" onClick={onBack}>
          <Icon name="back" size={17} />
          Documents
        </button>
        <span className="eyebrow">
          Document · {recording.source === 'import' ? 'Imported audio' : 'Recorded conversation'}
        </span>
        <button
          className="icon-button delete-button"
          aria-label="Delete document"
          aria-haspopup="dialog"
          disabled={controller.busy || draft.dirty || controller.audio.recording_state !== 'idle'}
          onClick={() => setConfirmDelete(true)}
        >
          <Icon name="trash" size={18} />
        </button>
      </div>
      <label className="title-label">
        <span className="sr-only">Document title</span>
        <input
          className="detail-title"
          value={draft.title}
          onChange={(event) => draft.setTitle(event.target.value)}
          maxLength={160}
        />
      </label>
      <div className="detail-meta">
        <span>
          {date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
        </span>
        <span>{date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
        <span>{formatBytes(recording.size_bytes)}</span>
      </div>
      <AudioPlayer recording={recording} controller={controller} />
      <div className="transcript-header">
        <div className="section-heading">
          <Icon name="text" />
          <h2>Document</h2>
          {recording.transcript &&
            (recording.transcript.language !== 'und' || !recording.transcript.model_id) && (
              <span className="language-chip">
                <Icon name="globe" size={13} />
                {recording.transcript.language === 'und'
                  ? 'Written notes'
                  : languageName(recording.transcript.language)}
              </span>
            )}
        </div>
        {recording.transcript && (
          <button
            className="text-button"
            disabled={
              !controller.capabilities.sharing ||
              controller.busy ||
              draft.dirty ||
              controller.audio.recording_state !== 'idle'
            }
            onClick={() => void controller.shareTranscript(recording)}
          >
            <Icon name="share" size={16} />
            Share text
          </button>
        )}
      </div>
      <TranscriptionStatus
        recording={recording}
        controller={controller}
        onModel={onModel}
        dirty={draft.dirty}
      />
      {recording.transcript || writing ? (
        <div className="document-paper">
          <label>
            <span className="sr-only">Document text</span>
            <textarea
              className="document-editor"
              value={draft.text}
              onChange={(event) => draft.setText(event.target.value)}
              placeholder="Write your notes here…"
              spellCheck
            />
          </label>
        </div>
      ) : (
        <div className="document-empty">
          <Icon name="text" size={32} />
          <h3>No document text yet</h3>
          <p>Transcribe the audio or write your own notes.</p>
          <button className="text-button" onClick={() => setWriting(true)}>
            <Icon name="edit" size={15} />
            Write notes
          </button>
        </div>
      )}
      {draft.dirty && (
        <div className="save-bar document-save">
          <span>Unsaved changes</span>
          <button className="text-button" onClick={draft.discard} disabled={controller.busy}>
            Discard
          </button>
          <button
            className="button button-dark button-small"
            onClick={() => void draft.save()}
            disabled={controller.busy}
          >
            Save changes
          </button>
        </div>
      )}
      {confirm_delete && (
        <ConfirmDialog
          title={`Delete “${recording.title}”?`}
          description="This permanently removes the document, its audio, and its saved text."
          confirm_label="Delete document"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            void controller.remove(recording);
          }}
        />
      )}
    </section>
  );
}
