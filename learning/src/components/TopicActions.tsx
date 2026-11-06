import { useEffect, useRef } from 'react';
import type { Topic } from '../lib/types';

export function TopicActions({
  topic,
  close,
  remove,
}: {
  topic: Topic;
  close: () => void;
  remove: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    return () => node.close();
  }, []);
  return (
    <dialog
      className="topic-actions"
      ref={dialog}
      aria-labelledby="topic-actions-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <h2 id="topic-actions-title">Topic options</h2>
      <p>
        {topic.model
          ? `Model: ${topic.model.model_id}`
          : 'No model selected yet.'}
      </p>
      {topic.key_points.length > 0 && (
        <p className="form-note">
          This topic keeps its model so saved conversations can resume.
        </p>
      )}
      <button
        className="action-row danger"
        onClick={() => {
          close();
          remove();
        }}
      >
        Delete topic
      </button>
      <button className="action-row" onClick={close}>
        Done
      </button>
    </dialog>
  );
}
