import { Icon } from './Icon';

export function TripCities({
  cities,
  onPick,
  onChange,
}: {
  cities: string[];
  onPick(index: number): void;
  onChange(cities: string[]): void;
}) {
  function moveEarlier(index: number) {
    const next = [...cities];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    onChange(next);
  }

  return (
    <section className="trip-city-editor" aria-label="Trip cities">
      <h3>{cities.length > 1 ? 'Cities' : 'City'}</h3>
      {cities.length > 0 && (
        <ol>
          {cities.map((city, index) => (
            <li key={index}>
              <button
                type="button"
                className="city-leg"
                aria-label={`Change city ${city}`}
                aria-description={cities.length > 1 ? `City ${index + 1}` : undefined}
                onClick={() => onPick(index)}
              >
                <span className="city-leg-marker" aria-hidden="true">
                  {index === 0 ? <Icon name="pin" size={16} /> : index + 1}
                </span>
                <span className="city-leg-name">
                  {index === 0 && cities.length > 1 && <small>Starting city</small>}
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
              {cities.length > 1 && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove city ${city}`}
                  onClick={() => onChange(cities.filter((_, position) => position !== index))}
                >
                  <Icon name="close" size={16} />
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
      <button type="button" className="add-trip-city" onClick={() => onPick(cities.length)}>
        <Icon name="plus" size={17} />
        Add city
      </button>
    </section>
  );
}
