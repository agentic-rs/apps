export function CoordinateInputs({
  prefix,
  latitude,
  longitude,
  onLatitude,
  onLongitude,
}: {
  prefix: string;
  latitude: string;
  longitude: string;
  onLatitude(value: string): void;
  onLongitude(value: string): void;
}) {
  return (
    <div className="form-grid">
      <label>
        {prefix} latitude
        <input
          type="number"
          step="any"
          min={-90}
          max={90}
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
          value={longitude}
          onChange={(e) => onLongitude(e.target.value)}
          placeholder="—"
        />
      </label>
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
