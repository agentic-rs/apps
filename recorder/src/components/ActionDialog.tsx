import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import dialogPolyfill from 'dialog-polyfill';
import 'dialog-polyfill/dist/dialog-polyfill.css';

export function ActionDialog({
  title,
  description,
  className = 'action-dialog',
  onCancel,
  children,
}: {
  title: string;
  description?: string;
  className?: string;
  onCancel: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    const node = dialog.current!;
    const trigger = document.activeElement;
    if (typeof node.showModal !== 'function') dialogPolyfill.registerDialog(node);
    node.showModal();
    node.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled)')?.focus();
    return () => {
      node.close();
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className={className}
      role="dialog"
      aria-modal="true"
      aria-labelledby={id}
      aria-describedby={description ? `${id}-description` : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id={id}>{title}</h2>
      {description && <p id={`${id}-description`}>{description}</p>}
      {children}
    </dialog>,
    document.body,
  );
}
