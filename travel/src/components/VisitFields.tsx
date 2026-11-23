import { useId, useState } from 'react';

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
  offset_help,
  onTime,
  onOffset,
}: {
  prefix: string;
  local_time: string;
  offset: string;
  offset_help: string;
  onTime(value: string): void;
  onOffset(value: string): void;
}) {
  const offsets = [
    ...new Set([...Array.from({ length: 113 }, (_, index) => index * 15 - 840), Number(offset)]),
  ].sort((a, b) => a - b);
  return (
    <div className="form-grid time-fields">
      <label>
        {prefix} date &amp; time
        <input
          required
          type="datetime-local"
          value={local_time}
          onChange={(e) => onTime(e.target.value)}
        />
      </label>
      <label>
        {prefix} time zone
        <select required value={offset} onChange={(e) => onOffset(e.target.value)}>
          {!offset && <option value="">Choose offset</option>}
          {offsets.map((value) => (
            <option key={value} value={value}>
              UTC{value >= 0 ? '+' : '−'}
              {String(Math.floor(Math.abs(value) / 60)).padStart(2, '0')}:
              {String(Math.abs(value) % 60).padStart(2, '0')}
            </option>
          ))}
        </select>
        <span className="field-help">{offset_help}</span>
      </label>
    </div>
  );
}
