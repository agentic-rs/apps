import { requestPlaceJson } from './place-http';
import { geoapifyOsmRef } from './place-providers';
import type { DirectoryRef } from './types';

export interface PlaceVisitorDetails {
  attribution: 'OpenStreetMap' | 'Geoapify';
  address?: string;
  opening_hours?: string;
  website?: string;
  fee?: string;
  adult_charge?: string;
  child_charge?: string;
  wheelchair?: string;
}

const osm_types = { N: 'node', W: 'way', R: 'relation' } as const;
const osm_pattern = /^[NWR][1-9]\d{0,15}$/;
// Dresel serves Geofabrik continent extracts. Their country assignments differ
// from geographic conventions (notably Turkey and Georgia). Use the planet
// service when the provider's country is absent or lacks a known extract.
// https://download.geofabrik.de/index-v1-nogeom.json
const extract_countries: Record<string, string> = {
  api: 'AD AL AT BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GE GR HR HU IE IS IT LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS SE SI SK TR UA',
  'api-af':
    'AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG ER ET GA GH GM GN GQ GW KE LR LS LY MA MG ML MR MU MW MZ NA NE NG RW SC SD SH SL SN SO SS ST SZ TD TG TN TZ UG ZA ZM ZW',
  'api-as':
    'AE AF AM AZ BD BH BN BT CN ID IL IN IQ IR JO JP KG KH KP KR KW KZ LA LB LK MM MN MV MY NP OM PH PK PS QA SG SY TH TJ TL TM TW UZ VN YE',
  'api-ca': 'BS BZ CR CU DO GT HN HT JM NI PA PR SV VI',
  'api-na': 'CA GL MX US',
  'api-oc': 'AU CK FJ FM KI MH NC NR NU NZ PF PG PN PW SB TK TO TV VU WF WS',
  'api-sa': 'AR BO BR CL CO EC GF GY PE PY SR UY VE',
};
const extract_by_country = new Map(
  Object.entries(extract_countries).flatMap(([path, codes]) =>
    codes.split(' ').map((code) => [code, path] as const),
  ),
);
const geoapify_source = { name: 'Geoapify', url: 'https://www.geoapify.com/' };
const regional_source = { name: 'Dresel Overpass', url: 'https://ovp.dresel.systems/en/' };
const global_source = { name: 'Private.coffee', url: 'https://overpass.private.coffee/' };

function osmRef(ref: DirectoryRef): string | undefined {
  const id =
    ref.provider === 'osm' ? ref.id : ref.provider === 'geoapify' ? ref.osm_ref : undefined;
  return id && osm_pattern.test(id) && Number.isSafeInteger(Number(id.slice(1))) ? id : undefined;
}

function hasGeoapifyId(ref: DirectoryRef): boolean {
  return ref.provider === 'geoapify' && /^[A-Za-z0-9_-]{1,512}$/.test(ref.id);
}

export function canShowPlaceDetails(
  ref: DirectoryRef,
  attribution: 'Photon' | 'Geoapify',
): boolean {
  return (attribution === 'Geoapify' && hasGeoapifyId(ref)) || Boolean(osmRef(ref));
}

export function placeDetailsSource(ref: DirectoryRef, attribution: 'Photon' | 'Geoapify') {
  if (attribution === 'Geoapify' && hasGeoapifyId(ref)) return geoapify_source;
  return extract_by_country.has(ref.country_code ?? '') ? regional_source : global_source;
}

function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// Reject oversized values instead of truncating a price, URL, or hours exception.
function text(value: unknown, limit = 512): string | undefined {
  if (typeof value !== 'string' || value.length > limit) return;
  const clean = value.trim().replace(/\s+/g, ' ');
  if (clean && !/[\u0000-\u001f\u007f]/.test(clean)) return clean;
}

function website(value: unknown): string | undefined {
  const address = text(value, 2048);
  if (!address || !/^https?:\/\//i.test(address) || /[\s\\]/.test(address)) return;
  try {
    const url = new URL(address);
    if (!url.username && !url.password) return url.href;
  } catch {
    // A malformed provider link has no usable destination.
  }
}

function osmAddress(tags: Record<string, unknown>): string | undefined {
  const full = text(tags['addr:full']);
  if (full) return full;
  const street = text(tags['addr:street']) ?? text(tags['addr:place']);
  if (!street) return;
  return [
    [text(tags['addr:housenumber']), street].filter(Boolean).join(' '),
    text(tags['addr:city']),
    text(tags['addr:postcode']),
  ]
    .filter(Boolean)
    .join(', ');
}

function yesNo(value: unknown): string | undefined {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return text(value, 256);
}

function facts(
  attribution: PlaceVisitorDetails['attribution'],
  tags: Record<string, unknown>,
  props: Record<string, unknown> = {},
): PlaceVisitorDetails {
  const facilities = object(props.facilities);
  const fee = yesNo(tags.fee) ?? yesNo(props.fee);
  return {
    attribution,
    address: text(props.formatted) ?? osmAddress(tags),
    opening_hours: text(props.opening_hours, 1024) ?? text(tags.opening_hours, 1024),
    website: website(props.website) ?? website(tags.website) ?? website(tags['contact:website']),
    fee: fee === 'no' ? fee : (text(tags.charge, 256) ?? fee),
    adult_charge: fee === 'no' ? undefined : text(tags['charge:adult'], 256),
    child_charge: fee === 'no' ? undefined : text(tags['charge:child'], 256),
    wheelchair: yesNo(tags.wheelchair) ?? yesNo(facilities.wheelchair),
  };
}

function readOsmDetails(payload: unknown, id: string): PlaceVisitorDetails {
  const { elements, remark } = object(payload);
  // An Overpass timeout can be returned as HTTP 200 with an empty partial result.
  if (!Array.isArray(elements) || remark)
    throw new Error('Could not read visitor details. Try again.');
  const kind = osm_types[id[0] as keyof typeof osm_types];
  const row = elements
    .map(object)
    .find((entry) => entry.type === kind && entry.id === Number(id.slice(1)));
  return facts('OpenStreetMap', object(row?.tags));
}

function readGeoapifyDetails(payload: unknown, ref: DirectoryRef): PlaceVisitorDetails {
  const { features } = object(payload);
  if (!Array.isArray(features)) throw new Error('Could not read visitor details. Try again.');
  const rows = features
    .map((f) => object(object(f).properties))
    .filter((p) => p.feature_type === 'details');
  const match = rows.find(
    (p) => p.place_id === ref.id || (ref.osm_ref && geoapifyOsmRef(p) === ref.osm_ref),
  );
  // The exact-ID endpoint may return a new canonical place ID for the same object.
  const props = match ?? (rows.length === 1 ? rows[0] : {});
  const returned_ref = geoapifyOsmRef(props);
  if (returned_ref && osmRef(ref) && returned_ref !== ref.osm_ref)
    return { attribution: 'Geoapify' };
  const datasource = object(props.datasource);
  const raw = datasource.sourcename === 'openstreetmap' ? object(datasource.raw) : {};
  return facts('Geoapify', raw, props);
}

export function createPlaceDetailsLookup(native: boolean, public_key: string) {
  const cache = new Map<string, { expires_at: number; details: PlaceVisitorDetails }>();
  return async (ref: DirectoryRef, signal: AbortSignal): Promise<PlaceVisitorDetails> => {
    signal.throwIfAborted();
    const geoapify = Boolean(public_key && hasGeoapifyId(ref));
    const id = geoapify ? ref.id : osmRef(ref);
    if (!id) throw new Error('Visitor details are unavailable for this place.');
    const extract = extract_by_country.get(ref.country_code ?? '');
    const key = JSON.stringify([
      geoapify ? 'geoapify' : (extract ?? 'global'),
      id,
      geoapify && osmRef(ref),
    ]);
    const cached = cache.get(key);
    if (cached && cached.expires_at > Date.now()) return cached.details;
    if (globalThis.navigator?.onLine === false)
      throw new Error('You’re offline. Reconnect to load visitor details.');
    let details: PlaceVisitorDetails;
    if (geoapify) {
      const url = new URL('https://api.geoapify.com/v2/place-details');
      url.search = new URLSearchParams({
        id,
        features: 'details',
        lang: 'en',
        apiKey: public_key,
      }).toString();
      details = readGeoapifyDetails(await requestPlaceJson(url, signal, native, 'details'), ref);
    } else {
      const kind = osm_types[id[0] as keyof typeof osm_types];
      const query = `[out:json][timeout:8];${kind}(${id.slice(1)});out tags;`;
      const url = extract
        ? new URL(`https://ovp.dresel.systems/${extract}/interpreter`)
        : new URL('https://overpass.private.coffee/api/interpreter');
      const payload = await requestPlaceJson(
        url,
        signal,
        native,
        'details',
        new URLSearchParams({ data: query }),
      );
      details = readOsmDetails(payload, id);
    }
    signal.throwIfAborted();
    cache.delete(key);
    if (cache.size >= 40) cache.delete(cache.keys().next().value!);
    cache.set(key, { expires_at: Date.now() + 60 * 60_000, details });
    return details;
  };
}
