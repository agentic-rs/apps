import { useEffect, useRef } from 'react';
import type { ConfirmationRequest } from '../lib/useLearning';

export function Confirmation({
  request,
  resolve,
}: {
  request: ConfirmationRequest;
  resolve: (confirmed: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    cancel.current?.focus();
    return () => node.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="confirm-dialog"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
      onCancel={(event) => {
        event.preventDefault();
        resolve(false);
      }}
    >
      <h2 id="confirm-title" className="confirm-title">
        {request.title}
      </h2>
      <p id="confirm-message" className="confirm-message">
        {request.message}
      </p>
      <div className="confirm-actions">
        <button ref={cancel} className="quiet" onClick={() => resolve(false)}>
          Keep working
        </button>
        <button
          className={request.danger ? 'primary danger' : 'primary'}
          onClick={() => resolve(true)}
        >
          {request.confirm_label}
        </button>
      </div>
    </dialog>
  );
}
