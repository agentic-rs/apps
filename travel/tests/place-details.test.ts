import { expect, spyOn, test } from 'bun:test';
import { canShowPlaceDetails, placeDetailsSource } from '../src/lib/place-details';
import { createStopLookup } from '../src/lib/stop-lookup';
import type { DirectoryRef } from '../src/lib/types';

const museum: DirectoryRef = { provider: 'osm', id: 'W921353198', country_code: 'JP' };
const signal = () => new AbortController().signal;
const element = (tags: Record<string, unknown>) => ({ type: 'way', id: 921353198, tags });

test('looks up exactly the selected element and reuses both positive and empty results', async () => {
  const lookup = createStopLookup(false, '');
  const spy = spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(
      Response.json({
        elements: [
          { type: 'node', id: 921353198, tags: { website: 'https://other.example' } },
          element({
            'addr:full': '〒630-8213 奈良県奈良市登大路町50番地',
            opening_hours: 'Mo off; Tu-Su 09:30-17:00; Dec 28-Jan 01 off',
            'contact:website': 'https://www.narahaku.go.jp',
            fee: 'yes',
            'charge:adult': '700 JPY',
            'charge:child': '0 JPY',
            wheelchair: 'yes',
          }),
        ],
      }),
    )
    .mockResolvedValueOnce(Response.json({ elements: [] }));
  try {
    const result = await lookup.details(museum, signal());
    expect(result).toEqual({
      attribution: 'OpenStreetMap',
      address: '〒630-8213 奈良県奈良市登大路町50番地',
      opening_hours: 'Mo off; Tu-Su 09:30-17:00; Dec 28-Jan 01 off',
      website: 'https://www.narahaku.go.jp/',
      fee: 'yes',
      adult_charge: '700 JPY',
      child_charge: '0 JPY',
      wheelchair: 'yes',
    });
    const [url, options] = spy.mock.calls[0];
    expect(String(url)).toBe('https://ovp.dresel.systems/api-as/interpreter');
    expect(placeDetailsSource(museum, 'Geoapify').name).toBe('Dresel Overpass');
    expect(options?.method).toBe('POST');
    expect(new URLSearchParams(String(options?.body)).get('data')).toBe(
      '[out:json][timeout:8];way(921353198);out tags;',
    );
    expect(
      await lookup.details(
        { provider: 'geoapify', id: 'legacy', osm_ref: museum.id, country_code: 'JP' },
        signal(),
      ),
    ).toBe(result);
    const empty_ref: DirectoryRef = { provider: 'osm', id: 'R12' };
    const empty = await lookup.details(empty_ref, signal());
    expect(String(spy.mock.calls[1][0])).toBe('https://overpass.private.coffee/api/interpreter');
    expect(placeDetailsSource(empty_ref, 'Photon').name).toBe('Private.coffee');
    expect(empty.website).toBeUndefined();
    expect(await lookup.details(empty_ref, signal())).toBe(empty);
    expect(spy).toHaveBeenCalledTimes(2);
  } finally {
    spy.mockRestore();
  }
});

test('reads only the selected Geoapify details feature and preserves canonicalized provider identity', async () => {
  const lookup = createStopLookup(false, 'test');
  const ref: DirectoryRef = { provider: 'geoapify', id: 'autocomplete-id', osm_ref: 'W77' };
  const props = {
    feature_type: 'details',
    place_id: 'canonical-id',
    formatted: '12 Museum Street, Nara',
    website: 'javascript:alert(1)',
    facilities: { wheelchair: true },
    datasource: {
      sourcename: 'openstreetmap',
      raw: {
        osm_type: 'w',
        osm_id: 77,
        'contact:website': 'https://museum.example/visit',
        fee: 'yes',
        charge: '700 JPY',
        'charge:child': '300 JPY',
      },
    },
  };
  const spy = spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(
      Response.json({
        features: [
          { properties: { ...props, feature_type: 'nearby', opening_hours: '24/7' } },
          { properties: props },
        ],
      }),
    )
    .mockResolvedValueOnce(Response.json({ features: [{ properties: props }] }));
  try {
    const details = await lookup.details(ref, signal());
    expect(details).toMatchObject({
      attribution: 'Geoapify',
      address: props.formatted,
      website: 'https://museum.example/visit',
      fee: '700 JPY',
      child_charge: '300 JPY',
      wheelchair: 'yes',
    });
    expect(placeDetailsSource(ref, 'Geoapify').name).toBe('Geoapify');
    expect(details.opening_hours).toBeUndefined();
    const url = new URL(String(spy.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe('https://api.geoapify.com/v2/place-details');
    expect(url.searchParams.get('id')).toBe(ref.id);
    expect(url.searchParams.get('features')).toBe('details');
    const conflicting = await lookup.details({ ...ref, osm_ref: 'W99' }, signal());
    expect(conflicting.website).toBeUndefined();
  } finally {
    spy.mockRestore();
  }
});

test('ignores unsafe URLs, incomplete addresses and unbounded values while keeping boolean facts', async () => {
  const lookup = createStopLookup(false, '');
  const spy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    Response.json({
      elements: [
        element({
          website: 'https://intruder@example.org/',
          'contact:website': 'data:text/html,hello',
          opening_hours: 'x'.repeat(1025),
          'addr:city': 'Nara',
          fee: 'no',
          'charge:adult': 'old price',
          'charge:child': 'old price',
          wheelchair: 'limited',
        }),
      ],
    }),
  );
  try {
    const details = await lookup.details(museum, signal());
    expect(details.website).toBeUndefined();
    expect(details.opening_hours).toBeUndefined();
    expect(details.address).toBeUndefined();
    expect(details.fee).toBe('no');
    expect(details.adult_charge).toBeUndefined();
    expect(details.child_charge).toBeUndefined();
    expect(details.wheelchair).toBe('limited');
  } finally {
    spy.mockRestore();
  }
});

test('rejects invalid references before dispatch and retries partial, aborted and failed responses', async () => {
  const lookup = createStopLookup(false, '');
  const abort = new AbortController();
  const spy = spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(
      Response.json({ elements: [], remark: 'runtime error: Query timed out' }),
    )
    .mockImplementationOnce(
      Object.assign(
        async () => {
          abort.abort();
          return Response.json({ elements: [element({ fee: 'no' })] });
        },
        { preconnect: fetch.preconnect },
      ),
    )
    .mockResolvedValueOnce(new Response('', { status: 503 }))
    .mockResolvedValueOnce(Response.json({ elements: [element({ fee: 'yes' })] }));
  try {
    for (const ref of [
      { provider: 'osm', id: 'W1);out;' },
      { provider: 'ourairports', id: '123' },
      { provider: 'geoapify', id: 'geo-id' },
    ] as const) {
      expect(canShowPlaceDetails(ref, 'Photon')).toBe(false);
      await expect(lookup.details(ref, signal())).rejects.toThrow('unavailable');
    }
    expect(canShowPlaceDetails({ provider: 'geoapify', id: 'geo-id' }, 'Geoapify')).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    await expect(lookup.details(museum, signal())).rejects.toThrow('Try again');
    await expect(lookup.details(museum, abort.signal)).rejects.toThrow();
    await expect(lookup.details(museum, signal())).rejects.toThrow('unavailable');
    expect((await lookup.details(museum, signal())).fee).toBe('yes');
    expect(spy).toHaveBeenCalledTimes(4);
  } finally {
    spy.mockRestore();
  }
});
