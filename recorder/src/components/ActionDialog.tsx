import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';

export function ActionDialog({
  title,
  description,
  onCancel,
  children,
}: {
  title: string;
  description?: string;
  onCancel: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    const node = dialog.current!;
    node.showModal();
    return () => node.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="action-dialog"
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
    </dialog>
  );
}
