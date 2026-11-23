import { useId, useState } from 'react';
import { formatUtcOffset } from '../lib/visit-clock';

export function CoordinateInputs({
  prefix,
  latitude,
  longitude,
  require_pair = false,
  onLatitude,
  onLongitude,
}: {
  prefix: string;
  latitude: string;
  longitude: string;
  require_pair?: boolean;
  onLatitude(value: string): void;
  onLongitude(value: string): void;
}) {
  const error_id = useId();
  const [attempted, setAttempted] = useState(false);
  const missing_coordinate = require_pair && !!latitude !== !!longitude;
  const show_error = attempted && missing_coordinate;
  return (
    <div className="form-grid" onInvalid={() => setAttempted(true)}>
      <label>
        {prefix} latitude
        <input
          type="number"
          step="any"
          min={-90}
          max={90}
          required={require_pair && !!longitude}
          aria-describedby={show_error ? error_id : undefined}
          value={latitude}
          onChange={(e) => onLatitude(e.target.value)}
          placeholder="—"
        />
      </label>
      <label>
        {prefix} longitude
        <input
          type="number"
          step="any"
          min={-180}
          max={180}
          required={require_pair && !!latitude}
          aria-describedby={show_error ? error_id : undefined}
          value={longitude}
          onChange={(e) => onLongitude(e.target.value)}
          placeholder="—"
        />
      </label>
      {show_error && (
        <p className="coordinate-pair-error" id={error_id} role="alert">
          Enter both latitude and longitude, or leave both blank.
        </p>
      )}
    </div>
  );
}

export function VisitTimeFields({
  prefix,
  local_time,
  offset,
  automatic_choices,
  suggested_offsets = [],
  time_error,
  offset_help,
  onTime,
  onOffset,
}: {
  prefix: string;
  local_time: string;
  offset: string;
  automatic_choices?: { value: string; label: string }[];
  suggested_offsets?: number[];
  time_error?: string;
  offset_help: string;
  onTime(value: string): void;
  onOffset(value: string): void;
}) {
  const group_id = useId();
  const offsets = new Set([
    ...Array.from({ length: 113 }, (_, index) => index * 15 - 840),
    ...suggested_offsets,
  ]);
  if (offset && Number.isFinite(Number(offset))) offsets.add(Number(offset));
  const choices = [...offsets]
    .sort((a, b) => a - b)
    .map((value) => (
      <option key={value} value={value}>
        {formatUtcOffset(value)}
      </option>
    ));
  return (
    <div className="form-grid time-fields">
      <label>
        <span id={group_id + '-date-label'}>{prefix} date &amp; time</span>
        <input
          required
          type="datetime-local"
          aria-labelledby={group_id + '-date-label'}
          aria-invalid={time_error ? true : undefined}
          aria-describedby={time_error ? group_id + '-error' : undefined}
          value={local_time}
          onChange={(e) => onTime(e.target.value)}
        />
        {time_error && (
          <span className="visit-time-error" role="alert" id={group_id + '-error'}>
            {time_error}
          </span>
        )}
      </label>
      <label>
        <span id={group_id + '-zone-label'}>{prefix} time zone</span>
        <select
          required
          value={offset}
          aria-labelledby={group_id + '-zone-label'}
          aria-describedby={offset_help ? group_id + '-zone-help' : undefined}
          onChange={(e) => onOffset(e.target.value)}
        >
          {!offset && <option value="">Choose offset</option>}
          {automatic_choices ? (
            <>
              <optgroup label="Automatic">
                {automatic_choices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Fixed offset">{choices}</optgroup>
            </>
          ) : (
            choices
          )}
        </select>
        {offset_help && (
          <span className="field-help" id={group_id + '-zone-help'}>
            {offset_help}
          </span>
        )}
      </label>
    </div>
  );
}
