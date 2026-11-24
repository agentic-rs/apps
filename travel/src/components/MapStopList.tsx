import { useEffect, useId, useState, type ReactNode } from 'react';
import type { ContinuingStay } from '../lib/hotel-stays';
import { stop_kind_labels, type PlannedStop } from '../lib/types';
import { Icon } from './Icon';
import { NearbyPlacesButton } from './NearbyPlacesButton';
import { StopOrderButtons, useStopOrder, type MoveStop } from './StopOrderButtons';

export interface MapNearbyActions {
  nearbyCategory(stop: PlannedStop): 'sight' | 'stay' | undefined;
  nearbyCity(stop: PlannedStop): string | undefined;
  onAddStop(category: 'sight' | 'stay', near: PlannedStop): void;
}

export function MapStopRow({
  stop,
  number,
  stay_label,
  onOpen,
  nearbyCategory,
  nearbyCity,
  onAddStop,
  order_controls,
}: MapNearbyActions & {
  stop: PlannedStop;
  number?: number;
  stay_label?: string;
  onOpen(id: string): void;
  order_controls?: ReactNode;
}) {
  const category = nearbyCategory(stop);
  const detail = [
    ...(stay_label ? [] : [stop.time, stop_kind_labels[stop.kind]]),
    nearbyCity(stop),
    !stop.position && 'No pin',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="map-planned-row" data-map-stop={stop.id}>
      <button
        type="button"
        className="map-stop-row"
        aria-label={stay_label ?? `Edit ${stop.title}`}
        aria-description={detail || undefined}
        onClick={() => onOpen(stop.id)}
      >
        {number !== undefined ? (
          <span className="map-stop-number">{number}</span>
        ) : (
          <span className="map-stay-symbol">
            <Icon name="bed" size={18} />
          </span>
        )}
        <span className="map-stop-copy">
          <strong>{stay_label ?? stop.title}</strong>
          {detail && <small>{detail}</small>}
        </span>
        <Icon name="next" size={15} />
      </button>
      {category && <NearbyPlacesButton stop={stop} category={category} onAddStop={onAddStop} />}
      {order_controls}
    </div>
  );
}

export function MapStopList({
  stops,
  continuing_stays,
  onOpenStop,
  onMoveStop,
  onReorderStops,
  onOptimize,
  nearbyCategory,
  nearbyCity,
  onAddStop,
}: MapNearbyActions & {
  stops: PlannedStop[];
  continuing_stays: ContinuingStay[];
  onOpenStop(id: string): void;
  onMoveStop: MoveStop;
  onReorderStops(): void;
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
          <>
            <button
              type="button"
              className="map-reorder-button"
              onClick={onReorderStops}
              disabled={moving}
              aria-label="Reorder stops"
              aria-haspopup="dialog"
              title="Reorder stops"
            >
              <Icon name="reorder" size={17} />
              <span>Reorder</span>
            </button>
            <button type="button" onClick={onOptimize}>
              <Icon name="route" size={17} />
              Optimize route
            </button>
          </>
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
                <MapStopRow
                  stop={stay.stop}
                  stay_label={stay.label}
                  onOpen={onOpenStop}
                  nearbyCategory={nearbyCategory}
                  nearbyCity={nearbyCity}
                  onAddStop={onAddStop}
                />
              </li>
            ))}
          </ul>
        )}
        {stops.length > 0 && (
          <ol className="map-stop-list" aria-label="Day route stops">
            {stops.map((stop, index) => (
              <li key={stop.id}>
                <MapStopRow
                  stop={stop}
                  number={index + 1}
                  onOpen={onOpenStop}
                  nearbyCategory={nearbyCategory}
                  nearbyCity={nearbyCity}
                  onAddStop={onAddStop}
                  order_controls={
                    <StopOrderButtons
                      stop={stop}
                      count={stops.length}
                      index={index}
                      moving={moving}
                      onMove={reorder}
                    />
                  }
                />
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
