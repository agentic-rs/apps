import { useEffect, useState } from 'react';
import type { Recording } from '../lib/types';
import type { RecorderController } from '../lib/useRecorder';

export function useRecordingDraft(recording: Recording, controller: RecorderController) {
  const saved_text = recording.transcript?.text ?? '';
  const [draft, setDraft] = useState({
    title: recording.title,
    text: saved_text,
    base_title: recording.title,
    base_text: saved_text,
  });
  useEffect(() => {
    // Background transcription can update a record while its editor is open.
    // Only untouched fields follow the new persisted value.
    setDraft((previous) => ({
      title: previous.title === previous.base_title ? recording.title : previous.title,
      text: previous.text === previous.base_text ? saved_text : previous.text,
      base_title: recording.title,
      base_text: saved_text,
    }));
  }, [recording.title, saved_text]);
  const dirty = draft.title !== draft.base_title || draft.text !== draft.base_text;
  const setTitle = (title: string) => setDraft((previous) => ({ ...previous, title }));
  const setText = (text: string) => setDraft((previous) => ({ ...previous, text }));
  const discard = () =>
    setDraft({
      title: recording.title,
      text: saved_text,
      base_title: recording.title,
      base_text: saved_text,
    });
  const save = () => {
    const changed_text = draft.text !== draft.base_text;
    return controller.save(
      {
        ...recording,
        title:
          draft.title === draft.base_title
            ? recording.title
            : draft.title.trim() || 'Untitled recording',
        // Preserve background results when only the title was edited.
        transcript: !changed_text
          ? recording.transcript
          : recording.transcript
            ? { ...recording.transcript, text: draft.text }
            : draft.text.trim()
              ? { text: draft.text, language: 'und', segments: [] }
              : null,
        transcript_edited: recording.transcript_edited || changed_text,
      },
      { title: draft.title !== draft.base_title, transcript: changed_text },
    );
  };
  return { title: draft.title, text: draft.text, dirty, setTitle, setText, discard, save };
}
