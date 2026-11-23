import { useId, useLayoutEffect, useRef, useState } from 'react';
import { directoryKey } from '../lib/directory-format';
import type { PlannedStop } from '../lib/types';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

interface PositionProps {
  stops: PlannedStop[];
  index: number;
  title: string;
  context: string;
  city_labels?: ReadonlyMap<string, string>;
  pending?: boolean;
  onChange(before_stop_id: string | null): void;
}

function positionAt(stops: PlannedStop[], index: number) {
  const before = index < stops.length;
  const anchor = stops[before ? index : stops.length - 1];
  return { anchor, label: `${before ? 'Before' : 'After'} ${anchor.title}` };
}

export function RoutePosition(props: PositionProps) {
  const { stops, index, city_labels, pending } = props;
  const [open, setOpen] = useState(false);
  const description = useId();
  if (!stops.length) return null;
  const { anchor, label } = positionAt(stops, index);
  const city = city_labels?.get(anchor.id);
  // A venue can be named for a different city. Suppress only an explicit locality.
  const show_city =
    city &&
    !anchor.title.split(/[,，·()（）]/u).some((part) => directoryKey(part) === directoryKey(city));
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
            : `${index + 1} of ${stops.length + 1} · ${label}${show_city ? ` · ${city}` : ''}`}
        </small>
        <Icon name="next" size={15} />
      </button>
      {open && <RoutePositionSheet {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

export function RoutePositionSheet({
  stops,
  index,
  title,
  context,
  city_labels,
  pending,
  onChange,
  onClose,
  back_label = 'Back to stop',
}: PositionProps & { onClose(): void; back_label?: string }) {
  const selected = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    selected.current?.focus();
  }, []);
  const count = stops.length + 1;
  return (
    <Dialog title="Route position" back_label={back_label} full_screen onDismiss={onClose}>
      <div className="stop-position-content">
        <header className="stop-position-context">
          <strong>{title}</strong>
          <span>{context}</span>
        </header>
        <ol className="stop-position-options" aria-label="Positions in this day">
          {Array.from({ length: count }, (_, slot) => {
            const { anchor, label } = positionAt(stops, slot);
            const before_id = stops[slot]?.id ?? null;
            const city = city_labels?.get(anchor.id);
            const previous = stops[slot - 1];
            const show_city = city && (!previous || city_labels?.get(previous.id) !== city);
            const current = !pending && slot === index;
            return (
              <li key={before_id === null ? 'end' : 'before-' + before_id}>
                {show_city && <h3 className="stop-position-city">{city} stops</h3>}
                <button
                  type="button"
                  ref={current ? selected : undefined}
                  aria-pressed={current}
                  aria-label={`Position ${slot + 1} of ${count}, ${label}`}
                  aria-description={city}
                  onClick={() => {
                    onChange(before_id);
                    onClose();
                  }}
                >
                  <span className="stop-position-number" aria-hidden="true">
                    {slot + 1}
                  </span>
                  <span>{label}</span>
                  {current && <Icon name="check" size={18} />}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </Dialog>
  );
}
