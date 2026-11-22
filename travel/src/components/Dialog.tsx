import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

export function Dialog({
  title,
  children,
  onDismiss,
  wide = false,
  full_screen = false,
}: {
  title: string;
  children: ReactNode;
  onDismiss(): void;
  wide?: boolean;
  full_screen?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const outside_press = useRef(false);
  const id = useId();
  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  function outside(client_x: number, client_y: number) {
    const bounds = ref.current!.getBoundingClientRect();
    return (
      client_x < bounds.left ||
      client_x > bounds.right ||
      client_y < bounds.top ||
      client_y > bounds.bottom
    );
  }
  return (
    <dialog
      ref={ref}
      className={`dialog${wide ? ' wide' : ''}${full_screen ? ' full-screen' : ''}`}
      aria-labelledby={id}
      onPointerDown={(event) => {
        outside_press.current =
          !full_screen &&
          event.target === event.currentTarget &&
          outside(event.clientX, event.clientY);
      }}
      onClick={(event) => {
        if (
          outside_press.current &&
          event.target === event.currentTarget &&
          outside(event.clientX, event.clientY)
        )
          onDismiss();
        outside_press.current = false;
      }}
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
