import { useEffect, useId, useState } from 'react';
import type { ContinuingStay } from '../lib/hotel-stays';
import { stop_kind_labels, type PlannedStop } from '../lib/types';
import { Icon } from './Icon';
import { StopOrderButtons, useStopOrder, type MoveStop } from './StopOrderButtons';

export function MapStopButton({
  stop,
  number,
  label,
  onOpen,
}: {
  stop: PlannedStop;
  number: number;
  label?: string;
  onOpen(id: string): void;
}) {
  return (
    <button
      type="button"
      className="map-stop-row"
      aria-label={label}
      onClick={() => onOpen(stop.id)}
    >
      <span className="map-stop-number">{number}</span>
      <span className="map-stop-copy">
        <strong>{stop.title}</strong>
        <small>
          {stop.time && `${stop.time} · `}
          {stop_kind_labels[stop.kind]}
          {!stop.position && ' · No pin'}
        </small>
      </span>
      <Icon name="next" size={15} />
    </button>
  );
}

export function MapStopList({
  stops,
  continuing_stays,
  onOpenStop,
  onMoveStop,
  onOptimize,
}: {
  stops: PlannedStop[];
  continuing_stays: ContinuingStay[];
  onOpenStop(id: string): void;
  onMoveStop: MoveStop;
  onOptimize(): void;
}) {
  const list_id = useId();
  const [roomy, setRoomy] = useState(() => window.matchMedia('(min-height: 700px)').matches);
  const [preference, setPreference] = useState<boolean | null>(null);
  const expanded = preference ?? roomy;
  const { moving, move_error, reorder } = useStopOrder(onMoveStop);
  useEffect(() => {
    const media = window.matchMedia('(min-height: 700px)');
    const update = () => setRoomy(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return (
    <section className="map-stop-list-pane" aria-label="Day route controls">
      <div className="route-action-bar">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={list_id}
          onClick={() => setPreference(!expanded)}
        >
          <Icon name="timeline" size={17} />
          {stops.length ? 'Stop list' : 'Hotel stays'}
          <span className="map-stop-count" aria-hidden="true">
            {stops.length || continuing_stays.length}
          </span>
          <Icon
            name="next"
            size={13}
            style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(-90deg)' }}
          />
        </button>
        {stops.length > 1 && (
          <button type="button" onClick={onOptimize}>
            <Icon name="route" size={17} />
            Optimize route
          </button>
        )}
      </div>
      <div className="map-stop-list-scroll" id={list_id} hidden={!expanded}>
        {move_error && (
          <p className="form-error" role="alert">
            {move_error}
          </p>
        )}
        {continuing_stays.length > 0 && (
          <ul className="map-stop-list map-hotel-list" aria-label="Hotel stays">
            {continuing_stays.map((stay) => (
              <li key={stay.stop.id}>
                <MapStayButton stay={stay} onOpen={onOpenStop} />
              </li>
            ))}
          </ul>
        )}
        {stops.length > 0 && (
          <ol className="map-stop-list" aria-label="Day route stops">
            {stops.map((stop, index) => (
              <li key={stop.id}>
                <MapStopButton
                  stop={stop}
                  number={index + 1}
                  label={`Edit ${stop.title}`}
                  onOpen={onOpenStop}
                />
                <StopOrderButtons
                  stop={stop}
                  count={stops.length}
                  index={index}
                  moving={moving}
                  onMove={reorder}
                />
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

export function MapStayButton({
  stay,
  onOpen,
}: {
  stay: ContinuingStay;
  onOpen(id: string): void;
}) {
  return (
    <button
      type="button"
      className="map-stop-row"
      aria-label={stay.label}
      onClick={() => onOpen(stay.stop.id)}
    >
      <span className="map-stay-symbol">
        <Icon name="bed" size={18} />
      </span>
      <span className="map-stop-copy">
        <strong>{stay.label}</strong>
        {(!stay.stop.position || stay.stop.city) && (
          <small>
            {[stay.stop.city, !stay.stop.position && 'No pin'].filter(Boolean).join(' · ')}
          </small>
        )}
      </span>
      <Icon name="next" size={15} />
    </button>
  );
}
