import { useState } from 'react';
import type { Trip } from '../lib/types';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

export function TripFilter({
  trips,
  selected_trip_id,
  onSelect,
}: {
  trips: Trip[];
  selected_trip_id: string;
  onSelect(id: string): void;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const options = [{ id: '', title: 'All trips' }, ...trips];
  const selected_title = options.find((trip) => trip.id === selected_trip_id)?.title ?? 'All trips';
  return (
    <>
      <button
        className="trip-filter"
        aria-label={`Trip filter: ${selected_title}`}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        <span>{selected_title}</span>
        <Icon name="chevron" size={14} />
      </button>
      {anchor && (
        <Dialog title="Filter trips" anchor={anchor} onDismiss={() => setAnchor(null)}>
          <div
            className="trip-options"
            role="listbox"
            aria-label="Trips"
            onKeyDown={(event) => {
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const items = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'),
              ];
              const current = items.indexOf(document.activeElement as HTMLButtonElement);
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? items.length - 1
                    : Math.max(
                        0,
                        Math.min(items.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)),
                      );
              items[next]?.focus();
            }}
          >
            {options.map((trip) => (
              <button
                key={trip.id}
                className="trip-option"
                role="option"
                aria-selected={trip.id === selected_trip_id}
                tabIndex={trip.id === selected_trip_id ? 0 : -1}
                autoFocus={trip.id === selected_trip_id}
                onClick={() => {
                  onSelect(trip.id);
                  setAnchor(null);
                }}
              >
                <span>{trip.title}</span>
                {trip.id === selected_trip_id && <Icon name="check" size={18} />}
              </button>
            ))}
          </div>
        </Dialog>
      )}
    </>
  );
}
