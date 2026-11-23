import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';
import { dismissBackLayer, useBackLayer } from '../lib/back-navigation';

export function Dialog({
  title,
  children,
  onDismiss,
  onBack = onDismiss,
  wide = false,
  full_screen = false,
  dismiss_disabled = false,
  back_label,
}: {
  title: string;
  children: ReactNode;
  onDismiss(): void;
  onBack?(): void;
  wide?: boolean;
  full_screen?: boolean;
  dismiss_disabled?: boolean;
  back_label?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const outside_press = useRef(false);
  const id = useId();
  useBackLayer(true, () => {
    if (!dismiss_disabled) onBack();
  });
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
          !dismiss_disabled &&
          event.target === event.currentTarget &&
          outside(event.clientX, event.clientY)
        )
          onDismiss();
        outside_press.current = false;
      }}
      onCancel={(event) => {
        event.preventDefault();
        dismissBackLayer();
      }}
    >
      <header className={`dialog-header${back_label ? ' dialog-back-header' : ''}`}>
        {back_label && (
          <button
            type="button"
            className="dialog-back"
            aria-label={back_label}
            disabled={dismiss_disabled}
            onClick={onBack}
          >
            <Icon name="back" size={17} /> Back
          </button>
        )}
        <h2 id={id}>{title}</h2>
        {!back_label && (
          <button
            type="button"
            className="icon-button"
            aria-label="Close dialog"
            disabled={dismiss_disabled}
            onClick={onDismiss}
          >
            <Icon name="close" />
          </button>
        )}
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
  const prompt = useRef<HTMLDivElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  useBackLayer(true, () => {
    if (!disabled) onKeep();
  });
  useLayoutEffect(() => {
    prompt.current?.scrollIntoView({ block: 'center' });
    keep.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div ref={prompt} className="discard-prompt" role="alert">
      <p>Discard your unsaved changes?</p>
      <div className="button-row">
        <button ref={keep} type="button" className="secondary" disabled={disabled} onClick={onKeep}>
          Keep editing
        </button>
        <button type="button" className="danger" disabled={disabled} onClick={onDiscard}>
          Discard changes
        </button>
      </div>
    </div>
  );
}
