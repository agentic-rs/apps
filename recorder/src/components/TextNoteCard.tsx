import { useState } from 'react';
import type { TextNote } from '../lib/types';
import type { RecorderController } from '../lib/useRecorder';
import { ConfirmDialog } from './ConfirmDialog';
import { Icon } from './Icon';

export function TextNoteCard({
  note,
  controller,
}: {
  note: TextNote;
  controller: RecorderController;
}) {
  const [confirm_delete, setConfirmDelete] = useState(false);
  const time = new Date(note.created_at).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  return (
    <article className="clip-card text-note" aria-label={`Text note at ${time}`}>
      <div className="clip-text">
        <p>{note.text}</p>
      </div>
      <footer className="clip-meta">
        <time dateTime={note.created_at}>{time}</time>
        <button
          className="icon-button"
          aria-label="Delete text note"
          aria-haspopup="dialog"
          disabled={controller.busy}
          onClick={() => setConfirmDelete(true)}
        >
          <Icon name="trash" size={14} />
        </button>
      </footer>
      {confirm_delete && (
        <ConfirmDialog
          title="Delete this text note?"
          description="This note will be removed from the channel."
          confirm_label="Delete note"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            void controller.removeTextNote(note.id);
          }}
        />
      )}
    </article>
  );
}
