import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { placeDetailsSource, type PlaceVisitorDetails } from '../lib/place-details';
import { placeTypeLabel } from '../lib/place-types';
import type { StopLookup } from '../lib/stop-lookup';
import { stop_kind_labels, type DirectoryRef, type StopKind } from '../lib/types';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import '../place-details.css';

const day_names: Record<string, string> = {
  Mo: 'Mon',
  Tu: 'Tue',
  We: 'Wed',
  Th: 'Thu',
  Fr: 'Fri',
  Sa: 'Sat',
  Su: 'Sun',
  PH: 'Public holidays',
  SH: 'School holidays',
};

function readableHours(value: string) {
  if (value === '24/7') return 'Open 24 hours daily';
  // Quoted notes and fallback rules may contain their own punctuation.
  if (value.includes('"') || value.includes('||')) return value;
  return value
    .split(';')
    .map((part) => {
      const rule = part.trim().replace(/\boff$/, 'closed');
      const match = /^([A-Za-z]{2}(?:[,-][A-Za-z]{2})*)\s+(.+)$/.exec(rule);
      if (!match) return rule;
      const [, days, hours] = match;
      if (days.split(/[,-]/).some((day) => !Object.hasOwn(day_names, day))) return rule;
      const names = days
        .replace(/[A-Za-z]{2}/g, (day) => day_names[day])
        .replaceAll('-', '–')
        .replaceAll(',', ', ');
      const times = hours.replace(/(\d{2}:\d{2})-(\d{2}:\d{2})/g, '$1–$2');
      return names + ' ' + times;
    })
    .filter(Boolean)
    .join('\n');
}

export function PlaceDetailsSheet({
  title,
  kind,
  city,
  day_label,
  directory_ref,
  lookup,
  native,
  back_label = 'Back to stop',
  onEditItinerary,
  onViewMap,
  route_distance,
  route_summary,
  focus_edit = false,
  primary_action,
  busy = false,
  action_error,
  onClose,
}: {
  title: string;
  kind: StopKind;
  city?: string;
  day_label?: string;
  directory_ref: DirectoryRef;
  lookup: StopLookup;
  native: boolean;
  back_label?: string;
  onEditItinerary?(): void;
  onViewMap?(trigger: HTMLButtonElement): void;
  route_distance?: string;
  route_summary?: string;
  focus_edit?: boolean;
  primary_action?: { label: string; disabled: boolean; onClick(trigger: HTMLButtonElement): void };
  busy?: boolean;
  action_error?: string;
  onClose(): void;
}) {
  const venue_heading = useRef<HTMLHeadingElement>(null);
  const edit_button = useRef<HTMLButtonElement>(null);
  const route_description = useId();
  const map_description = useId();
  useLayoutEffect(() => {
    if (focus_edit) edit_button.current?.focus({ preventScroll: true });
  }, [focus_edit]);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    ref: DirectoryRef;
    attempt: number;
    details: PlaceVisitorDetails | null;
  }>();
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const details = await lookup.details(directory_ref, controller.signal);
        if (!controller.signal.aborted) setResult({ ref: directory_ref, attempt, details });
      } catch {
        if (!controller.signal.aborted) setResult({ ref: directory_ref, attempt, details: null });
      }
    }
    void load();
    return () => controller.abort();
  }, [lookup, directory_ref, attempt]);
  const details =
    result?.ref === directory_ref && result.attempt === attempt ? result.details : undefined;
  const type = directory_ref.place_type
    ? placeTypeLabel(directory_ref.place_type)
    : stop_kind_labels[kind];
  const address = details?.address || directory_ref.subtitle;
  const address_label = details?.address ? 'Address' : 'Location';
  const map_described_by = [
    address && map_description + '-address',
    route_distance && map_description + '-distance',
  ]
    .filter(Boolean)
    .join(' ');
  const listed_address = !onViewMap && (details?.address || address !== city) ? address : undefined;
  const website =
    details?.website && /^https?:\/\//i.test(details.website) ? details.website : undefined;
  const source = placeDetailsSource(directory_ref, lookup.attribution);
  const credit =
    details?.attribution ?? (source.name === 'Geoapify' ? 'Geoapify' : 'OpenStreetMap');
  const charges = [
    details?.adult_charge && 'Adult · ' + details.adult_charge,
    details?.child_charge && 'Child · ' + details.child_charge,
  ].filter(Boolean);
  if (details?.fee === 'no') charges.unshift('No fee');
  else if (details?.fee === 'yes' && !charges.length) charges.push('Fee applies');
  else if (details?.fee && details.fee !== 'yes') charges.unshift(details.fee);
  const has_facts = Boolean(
    details?.address || details?.opening_hours || charges.length || details?.wheelchair || website,
  );
  const access = details?.wheelchair?.replace(
    /^(yes|no|limited|designated)$/,
    (value) => value[0].toUpperCase() + value.slice(1),
  );
  const facts = [
    [address_label, listed_address],
    ['Opening hours', details?.opening_hours && readableHours(details.opening_hours)],
    [kind === 'stay' ? 'Fee' : 'Admission', charges.join('\n')],
    ['Wheelchair access', access],
  ].filter(([, value]) => value);

  function displayUrl(url: string) {
    return native ? (
      url
    ) : (
      <a href={url} target="_blank" rel="noopener noreferrer">
        {url}
      </a>
    );
  }

  return (
    <Dialog
      title="Visitor details"
      back_label={back_label}
      full_screen
      onDismiss={onClose}
      dismiss_disabled={busy}
    >
      <div className="place-details-scroll">
        <article className="place-details-body">
          <header className="place-details-heading">
            <p>
              <Icon name={kind === 'stay' ? 'bed' : 'pin'} size={17} />
              {[type, city, day_label].filter(Boolean).join(' · ')}
            </p>
            <h3 ref={venue_heading} tabIndex={-1}>
              {title}
            </h3>
          </header>
          <div className="place-details-information">
            {onEditItinerary && (
              <button
                ref={edit_button}
                type="button"
                className="place-details-edit"
                aria-label="Edit itinerary details"
                aria-describedby={route_summary ? route_description : undefined}
                disabled={busy}
                onClick={onEditItinerary}
              >
                <Icon name="edit" size={18} />
                <span>
                  <strong>Edit itinerary details</strong>
                  {route_summary && <small id={route_description}>{route_summary}</small>}
                </span>
                <Icon name="next" size={15} />
              </button>
            )}
            {(onViewMap || facts.length > 0 || website) && (
              <div className="place-details-facts">
                {onViewMap && (
                  <button
                    type="button"
                    className="place-details-map-action"
                    aria-label="View on day map"
                    aria-describedby={map_described_by || undefined}
                    disabled={busy}
                    onClick={(event) => onViewMap(event.currentTarget)}
                  >
                    <span className="place-details-map-heading">
                      <span>{address_label}</span>
                      <span className="place-details-map-link">
                        <Icon name="map" size={17} /> Day map <Icon name="next" size={14} />
                      </span>
                    </span>
                    {(address || route_distance) && (
                      <span className="place-details-map-description">
                        {address && <span id={map_description + '-address'}>{address}</span>}
                        {route_distance && (
                          <small id={map_description + '-distance'}>{route_distance}</small>
                        )}
                      </span>
                    )}
                  </button>
                )}
                {(facts.length > 0 || website) && (
                  <dl>
                    {facts.map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                    {website && (
                      <div>
                        <dt>Website</dt>
                        <dd className="place-details-website">{displayUrl(website)}</dd>
                      </div>
                    )}
                  </dl>
                )}
              </div>
            )}
            {details === undefined && (
              <p className="place-details-status" role="status">
                Loading visitor details…
              </p>
            )}
            {details === null && (
              <div className="place-details-error">
                <p role="alert">Couldn’t load visitor details.</p>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    venue_heading.current?.focus({ preventScroll: true });
                    setAttempt((value) => value + 1);
                  }}
                >
                  Try again
                </button>
              </div>
            )}
            {details && !has_facts && (
              <p className="place-details-status" role="status">
                No visitor information is listed for this place.
              </p>
            )}
            <footer className="place-details-source">
              <p>{credit === 'Geoapify' && 'Geoapify · '}© OpenStreetMap contributors</p>
              <details>
                <summary>Source information</summary>
                <dl>
                  {[
                    ['Map copyright', 'https://www.openstreetmap.org/copyright'],
                    [source.name, source.url],
                  ].map(([label, url]) => (
                    <div key={url}>
                      <dt>{label}</dt>
                      <dd>{displayUrl(url)}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </footer>
          </div>
        </article>
      </div>
      {primary_action && (
        <footer className="dialog-footer place-details-footer">
          {action_error && (
            <p className="form-error" role="alert">
              {action_error}
            </p>
          )}
          <button
            type="button"
            className="primary"
            disabled={busy || primary_action.disabled}
            onClick={(event) => primary_action.onClick(event.currentTarget)}
          >
            {busy ? 'Saving…' : primary_action.label}
          </button>
        </footer>
      )}
    </Dialog>
  );
}
