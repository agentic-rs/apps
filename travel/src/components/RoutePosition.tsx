import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { PlannedStop } from '../lib/types';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

export function RoutePosition({
  stops,
  index,
  title,
  context,
  onChange,
}: {
  stops: PlannedStop[];
  index: number;
  title: string;
  context: string;
  onChange(before_stop_id: string | null): void;
}) {
  const [open, setOpen] = useState(false);
  const description = useId();
  const selected = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (open) selected.current?.focus();
  }, [open]);
  if (!stops.length) return null;
  const count = stops.length + 1;
  function relativeLabel(slot: number) {
    return slot < stops.length
      ? `Before ${stops[slot].title}`
      : `After ${stops[stops.length - 1].title}`;
  }
  return (
    <>
      <button
        className="stop-route-position"
        type="button"
        aria-label="Route position"
        aria-describedby={description}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <span>Route position</span>
        <small id={description}>
          {index + 1} of {count} · {relativeLabel(index)}
        </small>
        <Icon name="next" size={15} />
      </button>
      {open && (
        <Dialog
          title="Route position"
          back_label="Back to stop"
          full_screen
          onDismiss={() => setOpen(false)}
        >
          <div className="stop-position-content">
            <header className="stop-position-context">
              <strong>{title}</strong>
              <span>{context}</span>
            </header>
            <ol className="stop-position-options" aria-label="Positions in this day">
              {Array.from({ length: count }, (_, slot) => (
                <li key={stops[slot] ? 'before-' + stops[slot].id : 'end'}>
                  <button
                    type="button"
                    ref={slot === index ? selected : undefined}
                    aria-pressed={slot === index}
                    aria-label={`Position ${slot + 1} of ${count}, ${relativeLabel(slot)}`}
                    onClick={() => {
                      onChange(stops[slot]?.id ?? null);
                      setOpen(false);
                    }}
                  >
                    <span className="stop-position-number" aria-hidden="true">
                      {slot + 1}
                    </span>
                    <span>{relativeLabel(slot)}</span>
                    {slot === index && <Icon name="check" size={18} />}
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </Dialog>
      )}
    </>
  );
}
