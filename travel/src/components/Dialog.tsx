import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

export function Dialog({
  title,
  children,
  onDismiss,
  wide = false,
  full_screen = false,
  anchor,
}: {
  title: string;
  children: ReactNode;
  onDismiss(): void;
  wide?: boolean;
  full_screen?: boolean;
  anchor?: HTMLElement;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const outside_press = useRef(false);
  const id = useId();
  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    if (!anchor) return () => dialog.close();

    function position() {
      const trigger = anchor!.getBoundingClientRect();
      const viewport = window.visualViewport;
      const left_edge = (viewport?.offsetLeft ?? 0) + 8;
      const top_edge = (viewport?.offsetTop ?? 0) + 8;
      const right_edge = left_edge + (viewport?.width ?? innerWidth) - 16;
      const bottom_edge = top_edge + (viewport?.height ?? innerHeight) - 16;
      const below = Math.max(0, bottom_edge - trigger.bottom - 8);
      const above = Math.max(0, trigger.top - top_edge - 8);
      const open_below = below >= Math.min(dialog.scrollHeight, 320) || below >= above;
      dialog.style.maxWidth = `${right_edge - left_edge}px`;
      dialog.style.maxHeight = `${Math.min(480, open_below ? below : above)}px`;
      const bounds = dialog.getBoundingClientRect();
      dialog.style.left = `${Math.max(left_edge, Math.min(trigger.right - bounds.width, right_edge - bounds.width))}px`;
      dialog.style.top = `${Math.max(top_edge, Math.min(open_below ? trigger.bottom + 8 : trigger.top - bounds.height - 8, bottom_edge - bounds.height))}px`;
    }
    position();
    const observer = new ResizeObserver(position);
    observer.observe(dialog);
    observer.observe(anchor);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    window.visualViewport?.addEventListener('resize', position);
    window.visualViewport?.addEventListener('scroll', position);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      window.visualViewport?.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('scroll', position);
      dialog.close();
      if (anchor.isConnected) anchor.focus({ preventScroll: true });
    };
  }, [anchor]);
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
      className={`dialog${wide ? ' wide' : ''}${full_screen ? ' full-screen' : ''}${anchor ? ' popover' : ''}`}
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
