import { useRef, useState } from 'react';
import type { PlannedStop } from '../lib/types';
import { Icon } from './Icon';

export type MoveStop = (stop: PlannedStop, direction: -1 | 1) => Promise<void>;

export function useStopOrder(onMoveStop: MoveStop) {
  const pending = useRef(false);
  const [moving, setMoving] = useState(false);
  const [move_error, setMoveError] = useState('');
  async function reorder(stop: PlannedStop, direction: -1 | 1) {
    if (pending.current) return;
    pending.current = true;
    setMoving(true);
    setMoveError('');
    try {
      await onMoveStop(stop, direction);
    } catch (reason) {
      setMoveError(reason instanceof Error ? reason.message : 'Could not change the stop order.');
    } finally {
      pending.current = false;
      setMoving(false);
    }
  }
  return { moving, move_error, reorder };
}

export function StopOrderButtons({
  stop,
  index,
  count,
  moving,
  onMove,
}: {
  stop: PlannedStop;
  index: number;
  count: number;
  moving: boolean;
  onMove: MoveStop;
}) {
  if (count <= 1) return null;
  return (
    <div className="itinerary-reorder">
      <button
        type="button"
        className="icon-button"
        disabled={moving || index === 0}
        aria-label={`Move ${stop.title} earlier`}
        onClick={() => void onMove(stop, -1)}
      >
        <Icon name="arrow" size={16} style={{ transform: 'rotate(-90deg)' }} />
      </button>
      <button
        type="button"
        className="icon-button"
        disabled={moving || index === count - 1}
        aria-label={`Move ${stop.title} later`}
        onClick={() => void onMove(stop, 1)}
      >
        <Icon name="arrow" size={16} style={{ transform: 'rotate(90deg)' }} />
      </button>
    </div>
  );
}
