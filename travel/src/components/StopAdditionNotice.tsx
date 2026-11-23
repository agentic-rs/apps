import { useLayoutEffect, useRef, useState } from 'react';
import { formatTripDates } from '../lib/dates';
import type { PlannedStop } from '../lib/types';
import { Icon } from './Icon';
import '../stop-addition-notice.css';

export interface StopAddition {
  stop: PlannedStop;
  destination: string;
  city_label?: string;
  before_title?: string;
  undone?: boolean;
}

export function StopAdditionNotice({
  addition,
  onUndo,
  onDismiss,
  disabled = false,
}: {
  addition: StopAddition;
  onUndo(stop: PlannedStop): Promise<void>;
  onDismiss?(): void;
  disabled?: boolean;
}) {
  const { stop, destination, city_label, before_title, undone } = addition;
  const notice = useRef<HTMLDivElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const undo_button = useRef<HTMLButtonElement>(null);
  const in_flight = useRef(false);
  const focus_after_undo = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ id: string; message: string }>();
  const error = !undone && failure?.id === stop.id ? failure.message : undefined;

  useLayoutEffect(() => {
    if (undone && focus_after_undo.current === stop.id) {
      status.current?.focus({ preventScroll: true });
      focus_after_undo.current = null;
    }
    if (error && !disabled && !pending) {
      if (notice.current) notice.current.scrollTop = 0;
      undo_button.current?.focus({ preventScroll: true });
    }
  }, [undone, stop.id, error, disabled, pending]);

  async function undo() {
    if (disabled || undone || in_flight.current) return;
    in_flight.current = true;
    focus_after_undo.current = stop.id;
    setPending(true);
    setFailure(undefined);
    try {
      await onUndo(stop);
    } catch (reason) {
      focus_after_undo.current = null;
      setFailure({
        id: stop.id,
        message:
          reason instanceof Error && reason.message
            ? reason.message
            : 'Could not undo this addition. Try again.',
      });
    } finally {
      in_flight.current = false;
      setPending(false);
    }
  }

  const message = undone
    ? `${stop.title} removed from ${destination}.`
    : `${stop.title} added to ${destination}${before_title ? ` before ${before_title}` : ''}.`;
  const stay_dates =
    stop.kind === 'stay' &&
    (stop.checkout_date ? formatTripDates(stop.day, stop.checkout_date) : 'Check-out open');
  const detail = !undone && [city_label, stay_dates].filter(Boolean).join(' · ');

  return (
    <div className="stop-addition-notice" ref={notice}>
      <p
        className={error ? 'sr-only' : 'stop-addition-status'}
        role="status"
        aria-atomic="true"
        tabIndex={-1}
        ref={status}
      >
        <Icon name="check" size={16} />
        <span>
          <span>{message}</span>
          {detail && <small>{detail}</small>}
        </span>
      </p>
      {error && (
        <p className="stop-addition-error" role="alert">
          {error}
        </p>
      )}
      {(!undone || onDismiss) && (
        <div className="stop-addition-actions">
          {!undone && (
            <button
              type="button"
              className="stop-addition-undo"
              ref={undo_button}
              aria-label={`Undo adding ${stop.title}`}
              aria-busy={pending}
              disabled={disabled || pending}
              onClick={undo}
            >
              Undo
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              className="icon-button"
              aria-label="Dismiss stop confirmation"
              disabled={disabled || pending}
              onClick={onDismiss}
            >
              <Icon name="close" size={17} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
