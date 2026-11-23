import { useId, useLayoutEffect, useRef, useState } from 'react';
import { directoryKey } from '../lib/directory-format';
import type { PlannedStop } from '../lib/types';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

export function RoutePosition({
  stops,
  index,
  title,
  context,
  city_labels,
  pending = false,
  onChange,
}: {
  stops: PlannedStop[];
  index: number;
  title: string;
  context: string;
  city_labels?: ReadonlyMap<string, string>;
  pending?: boolean;
  onChange(before_stop_id: string | null): void;
}) {
  const [open, setOpen] = useState(false);
  const description = useId();
  const selected = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (open) selected.current?.focus();
  }, [open]);
  if (!stops.length) return null;
  const positions = [...stops, stops[stops.length - 1]].map((anchor, slot) => {
    const before = slot < stops.length;
    const city = city_labels?.get(anchor.id);
    // A venue can be named for a different city. Suppress only an explicit
    // locality, such as “National Museum (Kyoto)” or “National Museum, Kyoto”.
    const has_city =
      city &&
      anchor.title.split(/[,，·()（）]/u).some((part) => directoryKey(part) === directoryKey(city));
    return {
      before_stop_id: before ? anchor.id : null,
      label: `${before ? 'Before' : 'After'} ${anchor.title}`,
      city,
      city_detail: has_city ? undefined : city,
    };
  });
  const current = positions[index];
  const count = positions.length;
  return (
    <>
      <button
        className="stop-route-position"
        type="button"
        aria-label="Route position"
        aria-describedby={description}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span>Route position</span>
        <small id={description}>
          {pending
            ? 'Finding route position…'
            : `${index + 1} of ${count} · ${current.label}${current.city_detail ? ` · ${current.city_detail}` : ''}`}
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
              {positions.map((position, slot) => (
                <li
                  key={
                    position.before_stop_id === null ? 'end' : 'before-' + position.before_stop_id
                  }
                >
                  {position.city && position.city !== positions[slot - 1]?.city && (
                    <h3 className="stop-position-city">{position.city} stops</h3>
                  )}
                  <button
                    type="button"
                    ref={!pending && slot === index ? selected : undefined}
                    aria-pressed={!pending && slot === index}
                    aria-label={`Position ${slot + 1} of ${count}, ${position.label}`}
                    aria-description={position.city}
                    onClick={() => {
                      onChange(position.before_stop_id);
                      setOpen(false);
                    }}
                  >
                    <span className="stop-position-number" aria-hidden="true">
                      {slot + 1}
                    </span>
                    <span>{position.label}</span>
                    {!pending && slot === index && <Icon name="check" size={18} />}
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
