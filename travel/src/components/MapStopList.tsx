import { useEffect, useId, useState } from 'react';
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
  onOpenStop,
  onMoveStop,
  onOptimize,
}: {
  stops: PlannedStop[];
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
          Stop list
          <span className="map-stop-count" aria-hidden="true">
            {stops.length}
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
      </div>
    </section>
  );
}
