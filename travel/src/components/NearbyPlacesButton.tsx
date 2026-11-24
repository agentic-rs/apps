import type { PlannedStop } from '../lib/types';
import { Icon } from './Icon';

export function NearbyPlacesButton({
  stop,
  category,
  onAddStop,
}: {
  stop: PlannedStop;
  category: 'sight' | 'stay';
  onAddStop(category: 'sight' | 'stay', near: PlannedStop): void;
}) {
  const label = category === 'sight' ? 'sights' : 'hotels';
  return (
    <button
      type="button"
      className="nearby-places-button"
      aria-haspopup="dialog"
      aria-label={`Find ${label} near ${stop.title}`}
      onClick={(event) => {
        // Touch WebKit needs an explicit opener to restore focus when the picker closes.
        event.currentTarget.focus({ preventScroll: true });
        onAddStop(category, stop);
      }}
    >
      <Icon name={category === 'sight' ? 'landmark' : 'bed'} size={16} />
      Nearby {label}
    </button>
  );
}
