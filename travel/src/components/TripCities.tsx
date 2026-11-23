import { Icon } from './Icon';
import { arrivalDateBounds } from '../lib/city-days';
import type { TripCityLocation } from '../lib/types';

export interface CityLegDraft {
  city: string;
  location?: TripCityLocation | null;
  arrival_date: string;
}

export function TripCities({
  legs,
  start_date,
  end_date,
  onPick,
  onChange,
}: {
  legs: CityLegDraft[];
  start_date: string;
  end_date: string;
  onPick(index: number): void;
  onChange(legs: CityLegDraft[]): void;
}) {
  const schedule = {
    start_date,
    end_date,
    city_arrival_dates: legs.map((leg) => leg.arrival_date),
  };
  function moveEarlier(index: number) {
    const next = [...legs];
    next[index - 1] = { ...legs[index], arrival_date: legs[index - 1].arrival_date };
    next[index] = { ...legs[index - 1], arrival_date: legs[index].arrival_date };
    onChange(next);
  }
  function remove(index: number) {
    const next = legs.filter((_, i) => i !== index);
    if (index === 0 && next.length) next[0] = { ...next[0], arrival_date: '' };
    onChange(next);
  }
  function setDate(index: number, arrival_date: string) {
    onChange(legs.map((leg, i) => (i === index ? { ...leg, arrival_date } : leg)));
  }

  return (
    <section className="trip-city-editor" aria-label="Trip cities">
      <h3>{legs.length > 1 ? 'Cities' : 'City'}</h3>
      {legs.length > 0 && (
        <ol>
          {legs.map(({ city, arrival_date }, index) => {
            const { min, max } = arrivalDateBounds(schedule, index);
            const outside_range =
              arrival_date && ((min && arrival_date < min) || (max && arrival_date > max));
            return (
              <li key={index}>
                <div className="trip-city-row">
                  <button
                    type="button"
                    className="city-leg"
                    aria-label={`Change city ${city}`}
                    aria-description={legs.length > 1 ? `City ${index + 1}` : undefined}
                    onClick={() => onPick(index)}
                  >
                    <span className="city-leg-marker" aria-hidden="true">
                      {index === 0 ? <Icon name="pin" size={16} /> : index + 1}
                    </span>
                    <span className="city-leg-name">
                      {index === 0 && legs.length > 1 && <small>Starting city</small>}
                      <strong>{city}</strong>
                    </span>
                    <Icon name="next" size={14} />
                  </button>
                  {index > 0 && (
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Move ${city} earlier`}
                      onClick={() => moveEarlier(index)}
                    >
                      <Icon name="arrow" size={16} style={{ transform: 'rotate(-90deg)' }} />
                    </button>
                  )}
                  {legs.length > 1 && (
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remove city ${city}`}
                      onClick={() => remove(index)}
                    >
                      <Icon name="close" size={16} />
                    </button>
                  )}
                </div>
                {index > 0 && (
                  <div className="city-leg-schedule">
                    <label>
                      <span>Travel date</span>
                      <input
                        type="date"
                        aria-label={`Travel date for ${city}`}
                        min={min || undefined}
                        max={max || undefined}
                        value={arrival_date}
                        onChange={(event) => setDate(index, event.target.value)}
                      />
                    </label>
                    {arrival_date && (
                      <button
                        type="button"
                        className="city-date-link"
                        aria-label={`Clear travel date for ${city}`}
                        onClick={() => setDate(index, '')}
                      >
                        Clear
                      </button>
                    )}
                    {outside_range && (
                      <p className="city-date-conflict">
                        Adjust this date to fit the trip dates and city order, or clear it.
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {legs.length > 1 && schedule.city_arrival_dates.some(Boolean) && (
        <p className="city-date-note">Moving a city keeps the dates in their current order.</p>
      )}
      <button type="button" className="add-trip-city" onClick={() => onPick(legs.length)}>
        <Icon name="plus" size={17} />
        Add city
      </button>
    </section>
  );
}
