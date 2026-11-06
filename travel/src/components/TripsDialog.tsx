import type { CheckIn, Trip } from '../lib/types';
import { formatTripDates } from '../lib/dates';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

export function TripsDialog({
  trips,
  visits,
  choosing,
  onSelect,
  onCreate,
  onEdit,
  onDelete,
  onClose,
}: {
  trips: Trip[];
  visits: CheckIn[];
  choosing: boolean;
  onSelect(trip: Trip): void;
  onCreate(): void;
  onEdit(trip: Trip): void;
  onDelete(trip: Trip): void;
  onClose(): void;
}) {
  return (
    <Dialog title={choosing ? 'Choose a trip' : 'Your trips'} onDismiss={onClose}>
      <div className="trips-list">
        {trips.length === 0 && <p className="muted">Start a trip to group your check-ins.</p>}
        {trips.map((trip) => (
          <div className="trip-row" key={trip.id}>
            <button className="trip-select" onClick={() => onSelect(trip)}>
              <span className="trip-symbol">
                <Icon name="compass" size={22} />
              </span>
              <span>
                <strong>{trip.title}</strong>
                <small>{formatTripDates(trip.start_date, trip.end_date)}</small>
                <small>
                  {visits.filter((visit) => visit.trip_id === trip.id).length} check-ins
                </small>
              </span>
            </button>
            {!choosing && (
              <div className="button-row">
                <button
                  className="icon-button"
                  aria-label={`Edit trip ${trip.title}`}
                  onClick={() => onEdit(trip)}
                >
                  <Icon name="edit" size={18} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`Delete trip ${trip.title}`}
                  onClick={() => onDelete(trip)}
                >
                  <Icon name="trash" size={18} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      <footer className="dialog-footer">
        <button className="primary" onClick={onCreate}>
          <Icon name="plus" size={18} />
          New trip
        </button>
      </footer>
    </Dialog>
  );
}
