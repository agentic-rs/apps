import { useEffect, useRef, useState } from 'react';
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
  primary_action?: { label: string; disabled: boolean; onClick(trigger: HTMLButtonElement): void };
  busy?: boolean;
  action_error?: string;
  onClose(): void;
}) {
  const venue_heading = useRef<HTMLHeadingElement>(null);
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
  const location = directory_ref.subtitle !== city ? directory_ref.subtitle : undefined;
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
    [details?.address ? 'Address' : 'Location', details?.address || location],
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
      back_label="Back to stop"
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
          {(facts.length > 0 || website) && (
            <dl className="place-details-facts">
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
