import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

export function Dialog({
  title,
  children,
  onDismiss,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onDismiss(): void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? 'dialog wide' : 'dialog'}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
    >
      <header className="dialog-header">
        <h2 id={id}>{title}</h2>
        <button type="button" className="icon-button" aria-label="Close dialog" onClick={onDismiss}>
          <Icon name="close" />
        </button>
      </header>
      {children}
    </dialog>
  );
}

export function DiscardPrompt({
  onKeep,
  onDiscard,
  disabled = false,
}: {
  onKeep(): void;
  onDiscard(): void;
  disabled?: boolean;
}) {
  return (
    <div className="discard-prompt" role="alert">
      <p>Discard your unsaved changes?</p>
      <div className="button-row">
        <button type="button" className="secondary" disabled={disabled} onClick={onKeep}>
          Keep editing
        </button>
        <button type="button" className="danger" disabled={disabled} onClick={onDiscard}>
          Discard changes
        </button>
      </div>
    </div>
  );
}
