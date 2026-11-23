import { strict as assert } from 'node:assert';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firefox, type Browser, type Locator, type Page } from 'playwright-core';
import sharp from 'sharp';
import type { LlmRequest } from '@apell/sdk';
import { directoryShard } from '../src/lib/directory-format';
import type { Journal } from '../src/lib/types';

// No device APIs or existing journal data are accessed. The real production
// SDK speaks to an in-memory host over its ordinary MessageChannel bridge.
const firefox_path = process.env.FIREFOX_PATH;
const dist_root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
if (!(await Bun.file(resolve(dist_root, 'index.html')).exists())) {
  throw new Error('Build the production app with bun run build before running this check.');
}

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/host') {
      return new Response(
        '<!doctype html><html><head><title>Native journal fixture</title></head><body><iframe id="applet" title="Travel applet" sandbox="allow-scripts" style="width:390px;height:720px;border:0"></iframe></body></html>',
        {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        },
      );
    }
    const path = resolve(dist_root, `.${url.pathname}`);
    if (!path.startsWith(`${dist_root}/`) || !(await Bun.file(path).exists()))
      return new Response('Not found', { status: 404 });
    const origin = url.origin;
    return new Response(Bun.file(path), {
      headers: {
        'Access-Control-Allow-Origin': 'null',
        'Content-Security-Policy': `default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' ${origin}; style-src 'unsafe-inline' ${origin}; img-src data: blob: ${origin}; font-src ${origin}; connect-src ${origin}; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`,
      },
    });
  },
});

interface BridgeRequest {
  type: 'request';
  request_id: string;
  method: string;
  params: Record<string, unknown>;
}

const files = new Map<string, number[]>();
const directories = new Set<string>();
const calls: string[] = [];
const http_urls: string[] = [];
const place_requests: { city: string; query: string }[] = [];
const event_images: number[][] = [];
const title_requests: LlmRequest[] = [];
const model_target = { connection_id: 'smoke-provider', model_id: 'smoke-model' };
let photo_bytes: number[] = [];
let cancel_photo = true;
let cancel_location = true;
let fail_next_write = false;
let journal_writes = 0;
let fail_map_tiles = false;
let fail_place_search = false;
let image_sequence = 0;

async function eventImage(local_time: string, latitude: number): Promise<number[]> {
  const bytes = await sharp({ create: { width: 16, height: 12, channels: 3, background: 'navy' } })
    .withExif({
      IFD0: { ImageDescription: 'PRIVATE-SYNTHETIC-CAPTION' },
      IFD2: { DateTimeOriginal: local_time, OffsetTimeOriginal: '+02:00' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: `${latitude}/1 0/1 0/1`,
        GPSLongitudeRef: 'E',
        GPSLongitude: '34/1 0/1 0/1',
      },
    })
    .jpeg()
    .toBuffer();
  return [...bytes];
}

// Both supported providers receive a city centre and category filters. Model both
// independently so a stale city, category or name produces different visible rows.
function placeResponse(url: URL) {
  const geoapify = url.origin === 'https://api.geoapify.com';
  const params = url.searchParams;
  const [longitude, latitude] = geoapify
    ? (params.get('filter') ?? '').replace('circle:', '').split(',').map(Number)
    : [Number(params.get('lon')), Number(params.get('lat'))];
  const cities = [
    { name: 'Kyoto', latitude: 35.011, longitude: 135.768 },
    { name: 'Nara', latitude: 34.682, longitude: 135.828 },
    { name: 'Osaka', latitude: 34.694, longitude: 135.502 },
  ];
  const city_index = cities.findIndex(
    (city) =>
      Math.abs(city.latitude - latitude) < 0.08 && Math.abs(city.longitude - longitude) < 0.08,
  );
  const query = params.get(geoapify ? 'name' : 'q') ?? '';
  place_requests.push({ city: cities[city_index]?.name ?? '', query });
  // A named 40 km search around Kyoto can include hotels in Nara.
  const venue_city = query === 'Nara test inn' ? 1 : city_index;
  const city = cities[venue_city];
  const categories = params.get('categories')?.split(',') ?? [];
  const tags = params.getAll('osm_tag');
  const venues = [
    { name: 'test museum', kind: 'museum', category: 'entertainment.museum' },
    { name: 'test inn', kind: 'hotel', category: 'accommodation.hotel' },
    {
      name: 'National Museum',
      kind: 'museum',
      category: 'entertainment.museum',
      city: 'Nara',
      coordinates: [135.838, 34.683],
    },
    { name: 'history museum', kind: 'museum', category: 'entertainment.museum' },
    { name: 'Canal Walk', key: 'leisure', kind: 'park', category: 'leisure.park' },
    { name: 'Canal Works', kind: 'museum', category: 'entertainment.museum' },
    { name: 'East Annex', kind: 'guest_house', category: 'accommodation.guest_house' },
    { name: 'West Annex', kind: 'hostel', category: 'accommodation.hostel' },
  ];
  const features = city
    ? venues.flatMap((venue, index) => {
        if (venue.city && venue.city !== city.name) return [];
        const name = `${city.name} ${venue.name}`;
        const include = geoapify
          ? categories.some(
              (value) => venue.category === value || venue.category.startsWith(value + '.'),
            )
          : tags.length === 0 || tags.includes(`${venue.key ?? 'tourism'}:${venue.kind}`);
        if (!include || !name.toLowerCase().includes(query.toLowerCase())) return [];
        const id = 100 + venue_city * venues.length + index;
        return [
          {
            type: 'Feature',
            properties: geoapify
              ? { name, city: city.name, place_id: 'fixture-' + id, categories: [venue.category] }
              : {
                  name,
                  city: city.name,
                  osm_id: id,
                  osm_type: 'N',
                  osm_key: venue.key ?? 'tourism',
                  osm_value: venue.kind,
                },
            geometry: {
              type: 'Point',
              coordinates: venue.coordinates ?? [city.longitude, city.latitude],
            },
          },
        ];
      })
    : [];
  return {
    status: fail_place_search || query === 'Unavailable inn' || query === 'Nara Park' ? 503 : 200,
    headers: [{ name: 'Content-Type', value: 'application/json' }],
    body: Array.from(
      // Model a short provider page. Narrowing by type can surface venues beyond the first page.
      new TextEncoder().encode(
        JSON.stringify({
          type: 'FeatureCollection',
          features: query ? features : features.slice(0, city?.name === 'Nara' ? 3 : 2),
        }),
      ),
    ),
  };
}

function hostCall(request: BridgeRequest): unknown {
  const { method, params } = request;
  calls.push(method);
  const path = typeof params.path === 'string' ? params.path : '';
  switch (method) {
    case 'fs.mkdir':
      directories.add(path);
      return null;
    case 'fs.list':
      return {
        entries: [...files]
          .filter(
            ([name]) => name.startsWith(`${path}/`) && !name.slice(path.length + 1).includes('/'),
          )
          .map(([name, bytes]) => ({
            name: name.slice(path.length + 1),
            kind: 'file',
            size_bytes: bytes.length,
          })),
      };
    case 'fs.stat': {
      const bytes = files.get(path);
      if (bytes) return { kind: 'file', size_bytes: bytes.length };
      if (directories.has(path)) return { kind: 'directory', size_bytes: 0 };
      throw new Error('The mock file does not exist.');
    }
    case 'fs.read': {
      const bytes = files.get(path);
      if (!bytes) throw new Error('The mock file does not exist.');
      const offset = Number(params.offset ?? 0);
      const length = Number(params.length ?? 65_536);
      return { bytes: bytes.slice(offset, offset + length), eof: offset + length >= bytes.length };
    }
    case 'fs.write': {
      if (fail_next_write && path === 'journal/journal.json') {
        fail_next_write = false;
        throw new Error('Simulated storage failure. Retry saving this draft.');
      }
      assert(Array.isArray(params.bytes));
      const bytes = params.bytes as number[];
      files.set(path, [...bytes]);
      if (path === 'journal/journal.json') journal_writes++;
      return { size_bytes: bytes.length };
    }
    case 'fs.remove':
      files.delete(path);
      return null;
    case 'photos.pick':
    case 'camera.capture': {
      if (method === 'photos.pick' && cancel_photo) {
        cancel_photo = false;
        return null;
      }
      const event_image = method === 'photos.pick' ? event_images.shift() : undefined;
      const bytes = event_image ?? photo_bytes;
      const image_path = `images/native-photo-${++image_sequence}.${event_image ? 'jpg' : 'png'}`;
      files.set(image_path, [...bytes]);
      return {
        path: image_path,
        mime_type: event_image ? 'image/jpeg' : 'image/png',
        size_bytes: bytes.length,
      };
    }
    case 'llm.config':
      return {
        ...model_target,
        mode: 'provider',
        provider_id: 'fixture',
        provider_name: 'Smoke fixture',
      };
    case 'llm.generate': {
      const generation = params as unknown as LlmRequest;
      title_requests.push(generation);
      const input = JSON.parse(String(generation.messages[1]?.content));
      const failed = title_requests.length === 1;
      const content = failed
        ? ''
        : input.local_time === '2026-06-10T19:30'
          ? 'June evening'
          : 'Evening stop';
      return {
        request_id: generation.request_id,
        status: failed ? 'failed' : 'completed',
        message: failed ? null : { role: 'assistant', content },
        content,
        finish_reason: failed ? null : 'stop',
        provenance: {
          connection_id: model_target.connection_id,
          requested_model_id: model_target.model_id,
          model_id: model_target.model_id,
        },
        tool_calls: [],
        media: [],
        error: failed
          ? { code: 'test_error', message: 'Simulated title service failure', retryable: true }
          : null,
      };
    }
    case 'location.current': {
      if (cancel_location) {
        cancel_location = false;
        return null;
      }
      return {
        latitude: 12.34567,
        longitude: 34.56789,
        accuracy_m: 7,
        timestamp_ms: Date.parse('2026-05-12T10:30:00.000Z'),
      };
    }
    case 'http.request': {
      const url = new URL(String(params.url));
      if (url.origin === 'https://photon.komoot.io' || url.origin === 'https://api.geoapify.com')
        return placeResponse(url);
      assert.equal(
        url.origin,
        'https://tile.openstreetmap.org',
        'Only the mocked tile service may be requested.',
      );
      assert(/^\/\d+\/\d+\/\d+\.png$/.test(url.pathname));
      http_urls.push(url.href);
      if (fail_map_tiles) return { status: 503, headers: [], body: [] };
      return {
        status: 200,
        headers: [
          { name: 'Content-Type', value: 'image/png' },
          { name: 'Cache-Control', value: 'public, max-age=604800' },
        ],
        body: [...photo_bytes],
      };
    }
    default:
      throw new Error(`Unexpected mock host method: ${method}`);
  }
}

function journal(): Journal {
  const bytes = files.get('journal/journal.json');
  assert(bytes, 'The journal snapshot should have been saved.');
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bytes))) as Journal;
}

async function imageReady(image: Locator) {
  await image.waitFor({ state: 'visible' });
  await image.evaluate(
    (element) =>
      new Promise<void>((resolve, reject) => {
        const image = element as HTMLImageElement;
        if (image.complete) {
          image.naturalWidth > 0 ? resolve() : reject(new Error('Photo decoding failed.'));
          return;
        }
        image.addEventListener('load', () => resolve(), { once: true });
        image.addEventListener('error', () => reject(new Error('Photo decoding failed.')), {
          once: true,
        });
      }),
  );
}

let browser: Browser | undefined;
let page: Page | undefined;
const errors: string[] = [];
const browser_messages: string[] = [];
try {
  browser = await firefox.launch({ executablePath: firefox_path, headless: true });
  page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  page.setDefaultTimeout(15_000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning')
      browser_messages.push(message.text());
  });
  await page.addInitScript(() => {
    if (window.parent !== window)
      Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined });
  });
  let pending_write: Promise<void> | undefined;
  let pending_place: Promise<void> | undefined;
  await page.exposeFunction('__travel_host_call', async (request: BridgeRequest) => {
    if (request.method === 'fs.write' && pending_write) await pending_write;
    const result = hostCall(request);
    if (request.method === 'http.request' && pending_place) {
      const params = new URL(String(request.params.url)).searchParams;
      if ((params.get('q') ?? params.get('name')) === 'Late inn') await pending_place;
    }
    return result;
  });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    errors.push(`Unexpected browser network request: ${url.origin}`);
    await route.abort();
  });
  await page.goto(`http://127.0.0.1:${server.port}/host`);
  photo_bytes = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 48;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#276b5a';
    context.fillRect(0, 0, 64, 48);
    context.fillStyle = '#f4cb88';
    context.fillRect(24, 12, 16, 24);
    return Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), (character) =>
      character.charCodeAt(0),
    );
  });
  await page.evaluate((base) => {
    const host = window as unknown as {
      __travel_host_call(request: BridgeRequest): Promise<unknown>;
      applet_port: MessagePort;
    };
    window.addEventListener('message', (event: MessageEvent) => {
      const frame = document.querySelector<HTMLIFrameElement>('#applet')!;
      if (event.source !== frame.contentWindow || event.data?.type !== 'apell:ready') return;
      const channel = new MessageChannel();
      host.applet_port = channel.port1;
      channel.port1.onmessage = async (
        message: MessageEvent<BridgeRequest | { type: 'navigation_back_result' }>,
      ) => {
        if (message.data.type === 'navigation_back_result') return;
        try {
          const result = await host.__travel_host_call(message.data);
          channel.port1.postMessage({
            type: 'response',
            request_id: message.data.request_id,
            result,
          });
        } catch (error) {
          channel.port1.postMessage({
            type: 'response',
            request_id: message.data.request_id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      };
      channel.port1.start();
      frame.contentWindow!.postMessage({ type: 'apell:init' }, '*', [channel.port2]);
    });
    document.querySelector<HTMLIFrameElement>('#applet')!.src = `${base}/index.html`;
  }, `http://127.0.0.1:${server.port}`);

  const frame = page.frameLocator('#applet');
  const shellBack = () =>
    frame
      .owner()
      .page()
      .evaluate(
        () =>
          new Promise<boolean>((resolve, reject) => {
            const port = (window as unknown as { applet_port: MessagePort }).applet_port;
            const request_id = crypto.randomUUID();
            const timeout = setTimeout(() => {
              port.removeEventListener('message', reply);
              reject(new Error('The applet did not acknowledge native Back.'));
            }, 5_000);
            function reply(event: MessageEvent) {
              if (
                event.data?.type !== 'navigation_back_result' ||
                event.data.request_id !== request_id
              )
                return;
              clearTimeout(timeout);
              port.removeEventListener('message', reply);
              resolve(event.data.handled);
            }
            port.addEventListener('message', reply);
            port.postMessage({ type: 'navigation_back', request_id });
          }),
      );
  await frame.getByRole('heading', { name: 'Your trips', exact: true }).waitFor();
  assert.equal(await shellBack(), false, 'Back from the library returns to the shell.');
  const native_frame = page.frames().find((candidate) => candidate.url().endsWith('/index.html'))!;
  assert.equal(
    await native_frame.evaluate(() => self.origin),
    'null',
    'The applet must use an opaque origin.',
  );
  assert.equal(
    await native_frame.evaluate(() => typeof crypto.randomUUID),
    'undefined',
    'Exercise the custom-scheme UUID fallback.',
  );
  assert.equal(http_urls.length, 0, 'The trip library must not request map tiles.');
  await frame.getByRole('button', { name: 'New trip', exact: true }).click();
  const first_city = frame.getByRole('dialog', { name: 'Choose a city', exact: true });
  await first_city.waitFor();
  assert.equal(
    await shellBack(),
    true,
    'Back must dismiss the city picker before leaving the applet.',
  );
  await first_city.waitFor({ state: 'hidden' });
  await frame.getByRole('button', { name: 'New trip', exact: true }).click();
  assert.equal(await frame.getByLabel('Trip name').count(), 0);
  await first_city.getByRole('searchbox', { name: 'Search cities' }).fill('東京');
  await first_city.getByRole('button', { name: 'Tokyo, Japan', exact: true }).evaluate((option) => {
    const button = option as HTMLButtonElement;
    button.click();
    button.click();
  });
  await frame.getByRole('heading', { name: 'Tokyo trip', exact: true }).waitFor();
  await frame.getByRole('region', { name: 'Day itinerary' }).waitFor();
  assert.equal(journal().trips.length, 1);
  assert.deepEqual(journal().trips[0].cities, ['Tokyo']);
  assert.equal(journal().trips[0].city_locations?.[0]?.id, 'geonames:1850147');
  const trip_id = journal().trips[0].id;
  await frame.getByRole('button', { name: 'Edit trip', exact: true }).click();
  await frame.getByLabel('Trip name').fill('Native bridge journey');
  assert.equal(await shellBack(), true);
  await frame.getByRole('button', { name: 'Keep editing', exact: true }).waitFor();
  assert.equal(await shellBack(), true, 'Back from a discard confirmation keeps the draft.');
  await frame
    .getByRole('button', { name: 'Keep editing', exact: true })
    .waitFor({ state: 'hidden' });
  assert.equal(await frame.getByLabel('Trip name').inputValue(), 'Native bridge journey');
  await frame.getByLabel('Start date').fill('2026-05-12');
  await frame.getByLabel('End date').fill('2026-05-13');
  let finish_write!: () => void;
  pending_write = new Promise<void>((resolve) => {
    finish_write = resolve;
  });
  await frame.getByRole('button', { name: 'Save trip', exact: true }).click();
  await frame.getByRole('button', { name: 'Saving…', exact: true }).waitFor();
  assert.equal(await shellBack(), true, 'Back during a save stays in the applet.');
  assert(await frame.getByRole('button', { name: 'Saving…', exact: true }).isVisible());
  finish_write();
  pending_write = undefined;
  await frame.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(
    calls.filter((method) => method === 'fs.write').length,
    2,
    'Selecting a city twice and editing the saved trip should write once for each operation.',
  );
  const single_city_journal = journal();
  const trip_title = journal().trips[0].title;
  await frame.getByRole('heading', { name: trip_title, exact: true }).waitFor();
  await frame.getByRole('button', { name: 'Add a city', exact: true }).click();
  const add_city = frame.getByRole('dialog', { name: 'Add a city', exact: true });
  await add_city.getByRole('button', { name: 'Close dialog' }).click();
  await add_city.waitFor({ state: 'hidden' });
  assert.deepEqual(journal(), single_city_journal);
  await frame.getByRole('button', { name: 'Add a city', exact: true }).click();
  await add_city.getByRole('searchbox', { name: 'Search cities' }).fill('Kyoto');
  await add_city.getByRole('button', { name: 'Kyoto, Japan', exact: true }).click();
  const travel_day = frame.getByRole('dialog', { name: 'Travel day', exact: true });
  const confirm_city = travel_day.getByRole('button', { name: 'Add city', exact: true });
  await travel_day.getByRole('button', { name: 'Choose date later', exact: true }).click();
  assert.equal(await travel_day.getByLabel('Travel date').inputValue(), '');
  assert.equal(await shellBack(), true, 'Back from a travel date returns to city selection.');
  await add_city.getByRole('button', { name: 'Kyoto, Japan', exact: true }).click();
  assert.deepEqual(journal(), single_city_journal);
  await travel_day.getByLabel('Travel date').fill('2026-05-13');
  fail_next_write = true;
  await confirm_city.click();
  await travel_day.getByRole('alert').filter({ hasText: 'Simulated storage failure' }).waitFor();
  assert.deepEqual(journal(), single_city_journal);
  await confirm_city.click();
  await frame.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(journal().trips.length, 1);
  assert.equal(journal().trips[0].id, trip_id);
  assert.deepEqual(journal().trips[0].cities, ['Tokyo', 'Kyoto']);
  assert.deepEqual(
    journal().trips[0].city_locations?.map((city) => city?.id),
    ['geonames:1850147', 'geonames:1857910'],
  );
  assert.deepEqual(journal().trips[0].city_arrival_dates, ['', '2026-05-13']);
  const overview = frame.getByRole('dialog', { name: 'Trip overview', exact: true });
  await frame.getByRole('button', { name: 'Trip overview', exact: true }).click();
  await overview
    .getByRole('button', { name: 'Open itinerary for 2026-05-13', exact: true })
    .getByText('Tokyo → Kyoto', { exact: true })
    .waitFor();
  await overview
    .getByRole('button', { name: 'Open itinerary for 2026-05-12', exact: true })
    .click();
  await overview.waitFor({ state: 'detached' });
  const mainView = (name: string) =>
    frame
      .getByRole('navigation', { name: 'Main views' })
      .getByRole('button', { name, exact: true });
  assert.equal(
    await frame.getByRole('navigation', { name: 'Main views' }).getByRole('button').count(),
    4,
  );
  const dialog = frame.getByRole('dialog');
  for (const [title, latitude, longitude] of [
    ['Lakeside park', '12', '34'],
    ['Lookout terrace', '12.02', '34.02'],
  ]) {
    await frame.getByRole('button', { name: 'Add stop', exact: true }).click();
    await dialog.getByRole('button', { name: 'Enter manually' }).click();
    await dialog.getByLabel('Stop name').fill(title);
    assert.equal(await dialog.getByLabel('Day', { exact: true }).inputValue(), '2026-05-12');
    await dialog.locator('summary').click();
    await dialog.getByLabel('Stop latitude', { exact: true }).fill(latitude);
    await dialog.getByLabel('Stop longitude', { exact: true }).fill(longitude);
    await dialog.getByRole('button', { name: 'Add to Day 1', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  }
  assert.deepEqual(
    journal().stops.map(({ title }) => title),
    ['Lakeside park', 'Lookout terrace'],
  );
  assert.equal(http_urls.length, 0, 'Planning a stop must not request map tiles.');

  await frame.getByRole('button', { name: 'Check in at Lakeside park', exact: true }).click();
  assert.equal(
    await dialog.getByLabel('Place name', { exact: true }).inputValue(),
    'Lakeside park',
  );
  await dialog.getByLabel('City or area').fill('North district');
  await dialog.getByLabel('Visit date & time').fill('2026-05-12T18:30');
  await dialog.getByLabel('Visit time zone').selectOption('480');
  await dialog.getByLabel('Notes').fill('A native photo and a separate visit position.');

  await dialog.getByRole('button', { name: 'Use current location' }).click();
  await dialog.getByRole('button', { name: 'Use current location' }).waitFor({ state: 'visible' });
  assert.equal(
    await dialog.getByLabel('Visit latitude', { exact: true }).inputValue(),
    '',
    'Cancelling location must not invent coordinates.',
  );
  await dialog.getByRole('button', { name: 'Use current location' }).click();
  await dialog.getByText('Device location · ±7 m', { exact: true }).waitFor();
  assert.equal(await dialog.getByLabel('Visit latitude', { exact: true }).inputValue(), '12.34567');

  await dialog.getByRole('button', { name: 'Add photos', exact: true }).click();
  assert.equal(
    await dialog.locator('.draft-photos img').count(),
    0,
    'Cancelling the photo picker must not add a photo.',
  );
  await dialog.getByRole('button', { name: 'Add photos', exact: true }).click();
  await imageReady(dialog.getByRole('img', { name: 'Attached photo 1' }));
  await dialog.getByRole('button', { name: 'Take a photo', exact: true }).click();
  await imageReady(dialog.getByRole('img', { name: 'Attached photo 2' }));

  const snapshot_before = [...files.get('journal/journal.json')!];
  fail_next_write = true;
  await dialog.getByRole('button', { name: 'Save check-in', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: 'Simulated storage failure' }).waitFor();
  assert.deepEqual(
    files.get('journal/journal.json'),
    snapshot_before,
    'A failed write must preserve the previous snapshot.',
  );
  assert.equal(
    await dialog.getByLabel('Notes').inputValue(),
    'A native photo and a separate visit position.',
  );
  assert.equal(
    await dialog.getByRole('img').count(),
    2,
    'Photos must remain attached to the failed draft.',
  );
  await dialog.getByRole('button', { name: 'Save check-in', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  let saved = journal();
  assert.equal(saved.check_ins.length, 1);
  assert.equal(saved.check_ins[0].stop_id, saved.stops[0].id);
  assert.equal(saved.check_ins[0].photos.length, 2);
  assert.equal(saved.check_ins[0].visited_at, '2026-05-12T10:30:00.000Z');
  assert.deepEqual(saved.places[0].position, { latitude: 12, longitude: 34 });
  assert.deepEqual(saved.check_ins[0].actual_location, {
    latitude: 12.34567,
    longitude: 34.56789,
    accuracy_m: 7,
    source: 'device',
    captured_at: '2026-05-12T10:30:00.000Z',
  });
  await frame
    .getByRole('button', { name: 'Open photo: Lakeside park, photo 1', exact: true })
    .scrollIntoViewIfNeeded();
  await imageReady(frame.getByRole('img', { name: 'Lakeside park, photo 1', exact: true }));

  await frame.getByRole('button', { name: 'New check-in', exact: true }).click();
  await dialog.getByLabel('Choose a saved place').selectOption(saved.places[0].id);
  await dialog.getByLabel('Visit date & time').fill('2026-05-12T19:30');
  await dialog.getByLabel('Notes').fill('A return visit without recorded coordinates.');
  await dialog.getByRole('button', { name: 'Save check-in', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  saved = journal();
  assert.equal(saved.check_ins.length, 2);
  assert.equal(saved.check_ins[1].actual_location, null);

  const [first, second] = saved.stops;
  const optimizer = frame.getByRole('dialog', { name: 'Optimize day route', exact: true });
  const optimize = frame.getByRole('button', { name: 'Optimize route', exact: true });
  const day_map = frame.getByRole('button', { name: 'Open day map', exact: true });
  await day_map.click();
  const map_order_toggle = frame.getByRole('button', { name: 'Stop list', exact: true });
  if ((await map_order_toggle.getAttribute('aria-expanded')) === 'false')
    await map_order_toggle.click();
  const map_order = frame.getByRole('list', { name: 'Day route stops', exact: true });
  await map_order
    .getByRole('button', { name: 'Move Lookout terrace earlier', exact: true })
    .click();
  await frame.getByRole('button', { name: 'Stop 1, Lookout terrace', exact: true }).waitFor();
  assert.deepEqual(journal().check_ins, saved.check_ins);
  await map_order.getByRole('button', { name: 'Move Lookout terrace later', exact: true }).click();
  await frame.getByRole('button', { name: 'Stop 1, Lakeside park', exact: true }).waitFor();
  assert.deepEqual(journal(), saved);
  await optimize.click();
  await optimizer.getByLabel('Start stop').selectOption(second.id);
  assert.equal(await optimizer.getByLabel('Finish stop').inputValue(), first.id);
  await optimizer.getByRole('button', { name: 'Cancel' }).click();
  assert.deepEqual(journal(), saved, 'Cancelling a preview must preserve the complete trip.');
  await optimize.click();
  await optimizer.getByLabel('Start stop').selectOption(second.id);
  await optimizer.getByRole('button', { name: 'Apply order' }).click();
  await optimizer.waitFor({ state: 'hidden' });
  assert.deepEqual(journal().stops, [second, first]);
  assert.deepEqual(
    journal().check_ins,
    saved.check_ins,
    'A route change must preserve the linked visit and its photos.',
  );
  await frame.getByRole('button', { name: 'Stop 1, Lookout terrace', exact: true }).waitFor();

  await mainView('Toolbox').click();
  const openPacking = frame.getByRole('button', { name: 'Open packing list', exact: true });
  const openExpenses = frame.getByRole('button', { name: 'Open expenses', exact: true });
  const backToTools = frame.getByRole('main').getByRole('button', { name: 'Toolbox', exact: true });
  const documents = frame.getByRole('checkbox', { name: 'Travel documents', exact: true });
  await openPacking.click();
  await frame
    .getByRole('status')
    .filter({ hasText: /^0 of \d+ packed$/ })
    .waitFor();
  // The controlled checkbox changes once the asynchronous native snapshot write succeeds.
  await documents.click();
  await frame
    .getByRole('status')
    .filter({ hasText: /^1 of \d+ packed$/ })
    .waitFor();
  assert.equal(await shellBack(), true, 'Back from the packing list returns to the toolbox.');
  await openExpenses.click();
  await frame.getByRole('button', { name: 'Add expense', exact: true }).click();
  await dialog.getByLabel('Expense name').fill('Harbour ferry');
  await dialog.getByLabel('Amount', { exact: true }).fill('14.75');
  await dialog.getByRole('combobox', { name: /^Currency/ }).selectOption('EUR');
  await dialog.getByLabel('Date', { exact: true }).fill('2026-05-12');
  await dialog.getByRole('combobox', { name: /^Category/ }).selectOption('Transport');
  await dialog.getByRole('button', { name: 'Save expense', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  saved = journal();
  assert.equal(
    saved.trips[0].packing_items?.find((item) => item.title === 'Travel documents')?.packed,
    true,
  );
  const expense = saved.trips[0].expenses?.[0];
  assert(expense);
  assert.deepEqual(expense, {
    id: expense.id,
    title: 'Harbour ferry',
    amount_minor: 1475,
    currency: 'EUR',
    day: '2026-05-12',
    category: 'Transport',
  });

  await native_frame.goto(`http://127.0.0.1:${server.port}/index.html`);
  const reopen_trip = frame.getByRole('button', { name: `Open trip ${trip_title}`, exact: true });
  await reopen_trip.getByText('Tokyo → Kyoto', { exact: true }).waitFor();
  await reopen_trip.click();
  await frame.getByRole('button', { name: 'Edit Lookout terrace', exact: true }).waitFor();
  await day_map.click();
  await frame.getByRole('button', { name: 'Stop 1, Lookout terrace', exact: true }).waitFor();
  assert.deepEqual(journal(), saved, 'Route order and trip tools must survive reopening.');
  await optimize.click();
  await optimizer.getByLabel('Finish stop').selectOption(second.id);
  assert.equal(await optimizer.getByLabel('Start stop').inputValue(), first.id);
  await optimizer.getByRole('button', { name: 'Apply order' }).click();
  await optimizer.waitFor({ state: 'hidden' });
  assert.deepEqual(journal().stops, [first, second]);
  assert.deepEqual(journal().check_ins, saved.check_ins);
  saved = journal();
  await mainView('Toolbox').click();
  await openPacking.click();
  assert(await documents.isChecked());
  await backToTools.click();
  await openExpenses.click();
  const saved_expense = frame.getByRole('button', {
    name: 'Edit expense Harbour ferry',
    exact: true,
  });
  await saved_expense.getByText('EUR 14.75', { exact: true }).waitFor();
  await mainView('Journal').click();
  await frame.locator('.timeline-list .visit-card').nth(1).waitFor();
  await frame
    .getByRole('button', { name: 'Open photo: Lakeside park, photo 1', exact: true })
    .scrollIntoViewIfNeeded();
  await imageReady(frame.getByRole('img', { name: 'Lakeside park, photo 1', exact: true }));
  assert.deepEqual(journal(), saved, 'Reopening should preserve the saved journal and images.');
  const assertNativeLayout = async () => {
    const geometry = await native_frame.evaluate(() => {
      const footer = document.querySelector('.bottom-bar')!.getBoundingClientRect();
      return {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        body_height: document.body.scrollHeight,
        viewport_width: innerWidth,
        viewport_height: innerHeight,
        main_bottom: document.querySelector('main')!.getBoundingClientRect().bottom,
        main_height: document.querySelector('main')!.getBoundingClientRect().height,
        footer_top: footer.top,
        bottom: footer.bottom,
      };
    });
    assert(
      geometry.width <= geometry.viewport_width,
      'Native applet must not overflow horizontally.',
    );
    assert(
      geometry.height <= geometry.viewport_height + 1 &&
        geometry.body_height <= geometry.viewport_height + 1,
      'Native body must remain fixed while content scrolls.',
    );
    assert(
      Math.abs(geometry.bottom - geometry.viewport_height) <= 2,
      'Native bottom tabs must remain visible.',
    );
    assert(
      geometry.main_bottom <= geometry.footer_top + 1,
      'Navigation must not cover the main view.',
    );
    assert(
      geometry.main_height >= geometry.viewport_height / 2,
      'The main view must remain usable on a compact screen.',
    );
  };
  await assertNativeLayout();
  const qa_directory = resolve(dist_root, '../artifacts/qa');
  await mkdir(qa_directory, { recursive: true });
  await frame
    .locator('.app-shell')
    .screenshot({ path: resolve(qa_directory, 'native-timeline.png') });
  await mainView('Map').click();
  const itinerary_date = frame.getByLabel('Choose itinerary date', { exact: true });
  await itinerary_date.fill('2026-05-12');
  const second_stop = frame.getByRole('button', { name: 'Stop 2, Lookout terrace', exact: true });
  const assertPinsTouchable = async (expected: number) => {
    await native_frame.waitForFunction((count) => {
      const pins = [...document.querySelectorAll('.journal-map-pin')];
      return (
        innerWidth === 320 &&
        pins.length === count &&
        pins.every((pin) => {
          const number = pin.querySelector('.map-pin-bubble > span')!.getBoundingClientRect();
          const y = (number.top + number.bottom) / 2;
          return [number.left, number.right - 1].every((x) =>
            pin.contains(document.elementFromPoint(x, y)),
          );
        })
      );
    }, expected);
  };
  await second_stop.waitFor();
  assert.equal(await second_stop.getAttribute('data-stop-numbers'), '2');
  await frame.locator('.map-route-line').waitFor();
  await page.locator('#applet').evaluate((element) => {
    element.style.width = '320px';
    element.style.height = '568px';
  });
  await assertPinsTouchable(2);
  await frame.getByRole('button', { name: 'Fit all map pins' }).click();
  await assertPinsTouchable(2);
  await second_stop.click();
  await frame
    .getByRole('region', { name: 'Stops at selected map pin' })
    .getByRole('button', { name: /Lookout terrace/ })
    .click();
  assert.equal(await dialog.getByLabel('Stop name').inputValue(), 'Lookout terrace');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await dialog.waitFor({ state: 'hidden' });
  await itinerary_date.fill('2026-05-13');
  await frame.getByText('No stops on this day', { exact: true }).waitFor();
  assert.equal(await frame.locator('.journal-map-pin').count(), 0);
  await itinerary_date.fill('2026-05-12');
  await frame.getByRole('button', { name: 'Actual visits', exact: true }).click();
  await frame.locator('.journal-map-pin[data-visit-count="1"]').waitFor();
  await assertPinsTouchable(1);
  await frame.locator('.leaflet-tile-loaded').first().waitFor();
  await assertNativeLayout();
  assert.equal(await frame.locator('.journal-map-pin').getAttribute('data-latitude'), '12.34567');
  assert.equal(await frame.locator('.journal-map-pin').getAttribute('data-longitude'), '34.56789');
  await frame.getByRole('button', { name: '1 without visit coordinates' }).click();
  await frame
    .getByRole('region', { name: 'Entries without coordinates' })
    .getByRole('button', { name: 'View check-in' })
    .click();
  await dialog.getByRole('heading', { name: 'Lakeside park', exact: true }).waitFor();
  assert((await dialog.innerText()).includes('Location not recorded'));
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  assert.equal(await shellBack(), true, 'Back closes the map selection before leaving the tab.');
  await frame.getByRole('button', { name: 'Close map selection' }).waitFor({ state: 'hidden' });
  await frame.getByRole('button', { name: 'Named places', exact: true }).click();
  await frame.locator('.journal-map-pin[data-visit-count="2"]').waitFor();
  assert.equal(await frame.locator('.journal-map-pin').getAttribute('data-latitude'), '12');
  assert.equal(await frame.locator('.journal-map-pin').getAttribute('data-longitude'), '34');
  assert.equal(
    await frame.locator('.map-missing-button').count(),
    0,
    'A reference position locates both named-place visits without changing their actual coordinates.',
  );
  await frame.locator('.journal-map-pin').click();
  await frame
    .getByRole('region', { name: 'Entries at selected map pin' })
    .getByRole('button', { name: 'View check-in' })
    .first()
    .click();
  await dialog.getByRole('heading', { name: 'Lakeside park', exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await page.evaluate(() => {
    document.querySelector<HTMLIFrameElement>('#applet')!.style.height = '500px';
  });
  await assertNativeLayout();
  await mainView('Journal').click();
  await frame.getByRole('heading', { name: trip_title, exact: true }).waitFor();
  await assertNativeLayout();
  assert(http_urls.length > 0, 'Native map must use the mocked HTTP bridge.');
  assert(
    [...files.keys()].some((path) => path.startsWith('map-tiles/') && path.endsWith('.png')),
    'Native map should persist disposable tile-cache images.',
  );
  assert.deepEqual(journal(), saved, 'Map viewing must not change stored visit locations.');

  // Pick the evening photo first to exercise chronological grouping across picker calls.
  event_images.push(
    ...(await Promise.all([
      eventImage('2026:06:10 19:30:00', 16),
      eventImage('2026:06:10 08:28:00', 12),
      eventImage('2026:06:10 08:15:00', 12),
    ])),
  );
  await frame.getByRole('button', { name: 'Events from photos', exact: true }).click();
  const importer = frame.getByRole('dialog', { name: 'Events from photos', exact: true });
  for (let i = 0; i < 3; i++) {
    await importer.getByRole('button', { name: 'Choose photos', exact: true }).click();
  }
  await importer.getByRole('button', { name: 'Review events', exact: true }).click();
  assert.equal(event_images.length, 0);
  const drafts = importer.getByRole('article');
  const morning = drafts.nth(0);
  const evening = drafts.nth(1);
  await morning.getByText('Simulated title service failure', { exact: false }).waitFor();
  const save_events = importer.getByRole('button', { name: 'Save 2 events', exact: true });
  await save_events.waitFor();
  assert.equal(await drafts.count(), 2);
  assert.equal(await morning.getByLabel('Event title').inputValue(), '');
  assert.equal(await morning.getByLabel('Event date & time').inputValue(), '2026-06-10T08:15');
  assert.equal(await morning.getByLabel('Event time zone').inputValue(), '120');
  assert.equal(await morning.getByLabel('Event latitude').inputValue(), '12');
  assert.equal(await evening.getByLabel('Event date & time').inputValue(), '2026-06-10T19:30');
  assert.equal(await evening.getByLabel('Event longitude').inputValue(), '34');
  assert.equal(await evening.getByLabel('Event title').inputValue(), 'June evening');
  await morning.getByLabel('Event title').fill('June morning');
  await evening.getByLabel('Event title').fill('PRIVATE-TYPED-TITLE');
  await evening.getByLabel('Event date & time').fill('2026-06-10T20:10');
  await evening.getByLabel('Event longitude').fill('35');
  await evening.getByRole('button', { name: 'Suggest title', exact: true }).click();
  await save_events.waitFor();
  assert.equal(await evening.getByLabel('Event title').inputValue(), 'Evening stop');

  const model_inputs = title_requests.map((request) => {
    assert.deepEqual(request.target, model_target);
    assert.equal(request.stream, false);
    assert.deepEqual(
      request.messages.map(({ role }) => role),
      ['system', 'user'],
    );
    assert.deepEqual(Object.keys(request.messages[1]).sort(), ['content', 'role']);
    assert.equal(typeof request.messages[1].content, 'string');
    return JSON.parse(String(request.messages[1].content));
  });
  assert.deepEqual(model_inputs, [
    {
      local_time: '2026-06-10T08:15',
      utc_offset_minutes: 120,
      location: { latitude: 12, longitude: 34 },
    },
    {
      local_time: '2026-06-10T19:30',
      utc_offset_minutes: 120,
      location: { latitude: 16, longitude: 34 },
    },
    {
      local_time: '2026-06-10T20:10',
      utc_offset_minutes: 120,
      location: { latitude: 16, longitude: 35 },
    },
  ]);
  assert(
    !/PRIVATE-SYNTHETIC-CAPTION|PRIVATE-TYPED-TITLE|images\/native-photo|Native bridge journey/.test(
      JSON.stringify(title_requests),
    ),
  );
  fail_next_write = true;
  await save_events.click();
  await importer.getByText('Simulated storage failure', { exact: false }).waitFor();
  assert.deepEqual(
    journal(),
    saved,
    'A failed event batch must leave the complete journal intact.',
  );
  await save_events.click();
  await importer.waitFor({ state: 'hidden' });
  saved = journal();
  assert.equal(saved.check_ins.length, 4);
  const imported = saved.check_ins.filter((entry) => entry.title);
  assert.deepEqual(
    imported.map(
      ({ title, visited_at, utc_offset_minutes, place_id, actual_location, photos }) => ({
        title,
        visited_at,
        utc_offset_minutes,
        place_id,
        source: actual_location?.source,
        latitude: actual_location?.latitude,
        longitude: actual_location?.longitude,
        photos: photos.length,
      }),
    ),
    [
      {
        title: 'June morning',
        visited_at: '2026-06-10T06:15:00.000Z',
        utc_offset_minutes: 120,
        place_id: null,
        source: 'photo',
        latitude: 12,
        longitude: 34,
        photos: 2,
      },
      {
        title: 'Evening stop',
        visited_at: '2026-06-10T18:10:00.000Z',
        utc_offset_minutes: 120,
        place_id: null,
        source: 'manual',
        latitude: 16,
        longitude: 35,
        photos: 1,
      },
    ],
  );
  assert.equal(new Set(imported.flatMap(({ photos }) => photos.map(({ path }) => path))).size, 3);
  assert.equal(title_requests.length, 3, 'Retrying storage must preserve the reviewed titles.');

  await frame.getByRole('button', { name: 'Open event June morning', exact: true }).click();
  await dialog.getByRole('button', { name: 'Edit event', exact: true }).click();
  await dialog.getByLabel('Event title').fill('A quiet morning');
  await dialog.getByRole('button', { name: 'Save event', exact: true }).click();
  await dialog.getByRole('heading', { name: 'A quiet morning' }).waitFor();
  saved = journal();
  await native_frame.goto(`http://127.0.0.1:${server.port}/index.html`);
  await frame.getByRole('button', { name: `Open trip ${trip_title}`, exact: true }).click();
  await mainView('Journal').click();
  await frame.getByRole('button', { name: 'Open event A quiet morning', exact: true }).click();
  await imageReady(dialog.getByRole('img', { name: 'A quiet morning, photo 2' }));
  assert.deepEqual(journal(), saved);
  assert.equal(
    journal().check_ins.find(({ title }) => title === 'A quiet morning')?.id,
    imported[0].id,
  );
  assert.equal(title_requests.length, 3, 'Editing and reopening must not regenerate a title.');
  await dialog.getByRole('button', { name: 'Close dialog' }).click();

  await page.locator('#applet').evaluate((element) => {
    element.style.width = '390px';
    element.style.height = '720px';
  });
  for (const example of ['kyoto', 'singapore', 'kansai']) {
    const source = Bun.file(new URL(`../fixtures/${example}.json`, import.meta.url));
    files.set('journal/journal.json', [...(await source.bytes())]);
    const sample = journal();
    const [trip] = sample.trips;
    assert.equal(trip.id, `example-${example}`);
    assert(trip.cities?.length);
    await native_frame.goto(native_frame.url());
    await frame.getByRole('button', { name: `Open trip ${trip.title}`, exact: true }).click();
    await frame.getByRole('heading', { name: trip.title, exact: true }).waitFor();
    await frame.getByRole('button', { name: 'Trip overview', exact: true }).click();
    const transfer = example === 'kansai';
    const day = transfer ? trip.city_arrival_dates?.[1] : trip.start_date;
    assert(day);
    const cities = trip.cities.slice(0, transfer ? 2 : 1).join(' → ');
    const row = overview.getByRole('button', { name: `Open itinerary for ${day}`, exact: true });
    await row.getByText(cities, { exact: true }).waitFor();
    if (transfer) {
      await page
        .locator('#applet')
        .screenshot({ path: resolve(qa_directory, 'kansai-overview.png') });
    }
    await row.click();
    const itinerary = frame.getByRole('region', { name: 'Day itinerary' });
    await itinerary.getByRole('heading', { name: cities, exact: true }).waitFor();
    const titles = sample.stops.filter((stop) => stop.day === day).map((stop) => stop.title);
    assert(titles.length);
    const stops = itinerary.getByRole('list', { name: 'Planned stops' });
    assert.deepEqual(await stops.getByRole('button', { name: /^Edit / }).allTextContents(), titles);
    assert.deepEqual(journal(), sample, 'Browsing a fixture must preserve its saved itinerary.');
  }
  // The last fixture is open on the first Kansai transfer, with name-only legacy cities.
  const add_stop = frame.getByRole('button', { name: 'Add stop', exact: true });
  const add_hotel = frame.getByRole('button', { name: 'Add hotel', exact: true });
  const place_search = dialog.getByRole('searchbox', { name: 'Search places' });
  const search = dialog.getByRole('button', { name: 'Search', exact: true });
  const save_stop = dialog.getByRole('button', { name: /^(Add to Day 2|Save changes)$/ });
  const add_another = dialog.getByRole('button', { name: 'Add and choose another', exact: true });
  const sights = dialog.getByRole('button', { name: 'Sights', exact: true });
  const hotels = dialog.getByRole('button', { name: 'Hotels', exact: true });
  const kyoto = dialog.getByRole('button', { name: 'Search in Kyoto', exact: true });
  const nara = dialog.getByRole('button', { name: 'Search in Nara', exact: true });
  const kyoto_museum = dialog.getByRole('button', { name: /^Kyoto test museum/ });
  const nara_museum = dialog.getByRole('button', { name: /^Nara test museum/ });
  const nara_inn = dialog.getByRole('button', { name: /^Nara test inn/ });
  const change_dates = dialog.getByRole('button', { name: 'Change stay dates', exact: true });
  const stay_dates = frame.getByRole('dialog', { name: 'Stay dates', exact: true });
  const arrival = stay_dates.getByRole('button', { name: 'Check-in', exact: true });
  const departure = stay_dates.getByRole('button', { name: 'Check-out', exact: true });
  const calendar = stay_dates.getByLabel('Choose calendar date', { exact: true });
  const apply_dates = stay_dates.getByRole('button', { name: 'Done', exact: true });
  const cancel_dates = stay_dates.getByRole('button', { name: 'Cancel', exact: true });
  const confirm_stay = stay_dates.getByRole('button', { name: 'Add stay', exact: true });
  const choose_stay_dates = dialog.getByRole('button', { name: 'Choose stay dates', exact: true });
  async function assertStayDates(start: string, end: string, review = dialog) {
    await review.getByRole('button', { name: 'Change stay dates', exact: true }).click();
    assert.equal(await departure.getAttribute('aria-pressed'), 'true');
    assert.equal(await calendar.inputValue(), end);
    await arrival.click();
    assert.equal(await calendar.inputValue(), start);
    await cancel_dates.click();
  }
  const day_scroll = frame.locator('.daily-scroll');
  async function assertReturnedToStop(action_name: string) {
    // A Playwright click would scroll an offscreen stop into view, masking a lost return.
    const action = frame.getByRole('button', { name: action_name, exact: true });
    const location = await action.evaluate(async (button) => {
      await new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      );
      const bounds = button.getBoundingClientRect();
      const viewport = button.closest('.daily-scroll')!.getBoundingClientRect();
      return {
        focused: document.activeElement === button,
        visible: bounds.top >= viewport.top - 1 && bounds.bottom <= viewport.bottom + 1,
        top: Math.round(bounds.top),
        bottom: Math.round(bounds.bottom),
        viewport_bottom: Math.round(viewport.bottom),
      };
    });
    assert(location.focused && location.visible, `${action_name}: ${JSON.stringify(location)}`);
  }
  const day_two = '2030-05-21';
  const tiles_before_picking = http_urls.length;
  await add_stop.click();
  await kyoto_museum.waitFor();
  assert.equal(await sights.getAttribute('aria-pressed'), 'true');
  assert.equal(await kyoto.getAttribute('aria-pressed'), 'true');
  await nara.click();
  await nara_museum.waitFor();
  assert.equal(await kyoto_museum.count(), 0);
  const original_park = journal().stops.find((stop) => stop.title === 'Nara Park');
  assert(original_park?.position);
  await place_search.fill('Nara Park');
  await search.click();
  await dialog.getByRole('alert').waitFor();
  const saved_park = dialog
    .getByRole('list', { name: 'On this day' })
    .getByRole('button', { name: 'Edit planned stop Nara Park' });
  await saved_park.click();
  const park_editor = frame.getByRole('dialog', { name: 'Edit stop', exact: true });
  await park_editor.getByText('Day 2 · Kyoto → Nara', { exact: true }).waitFor();
  assert.equal(await park_editor.getByLabel('Notes').inputValue(), original_park.notes);
  assert.equal(
    await park_editor.getByLabel('Stop longitude', { exact: true }).inputValue(),
    String(original_park.position.longitude),
  );
  assert.equal(await shellBack(), true);
  assert.equal(await place_search.inputValue(), 'Nara Park');
  await dialog.getByRole('button', { name: 'Clear search', exact: true }).click();
  await nara_museum.waitFor();
  await hotels.click();
  await nara_inn.waitFor();
  await sights.click();
  await nara_museum.waitFor();
  assert.equal(await nara.getAttribute('aria-pressed'), 'true');
  await nara_museum.click();
  assert.equal(await dialog.getByLabel('Category').inputValue(), 'sight');
  await dialog.getByText('Day 2 · Nara', { exact: true }).waitFor();
  assert.equal(await shellBack(), true);
  await nara_museum.click();
  await save_stop.click();
  await dialog.waitFor({ state: 'hidden' });
  await assertReturnedToStop('Edit Nara test museum');

  await add_hotel.click();
  const before_clean_cancel = await day_scroll.evaluate((element) => element.scrollTop);
  assert.equal(await shellBack(), true);
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await day_scroll.evaluate((element) => element.scrollTop), before_clean_cancel);
  assert(await add_hotel.evaluate((button) => document.activeElement === button));
  await add_hotel.click();
  await nara_inn.waitFor();
  assert.equal(await hotels.getAttribute('aria-pressed'), 'true');
  assert.equal(await nara.getAttribute('aria-pressed'), 'true');
  await kyoto.click();
  await dialog.getByRole('button', { name: /^Kyoto test inn/ }).waitFor();
  assert.equal(await nara_inn.count(), 0);
  const search_in_nara = dialog.getByRole('button', {
    name: 'Search for “Nara test inn” in Nara',
    exact: true,
  });
  const before_transfer_search = place_requests.length;
  await place_search.fill('Nara test inn');
  assert.equal(await search_in_nara.count(), 0);
  await search.click();
  await search_in_nara.waitFor();
  assert.equal(await nara_inn.count(), 0);
  assert.deepEqual(place_requests.slice(before_transfer_search), [
    { city: 'Kyoto', query: 'Nara test inn' },
  ]);
  await search_in_nara.click();
  await nara_inn.waitFor();
  assert.equal(await hotels.getAttribute('aria-pressed'), 'true');
  assert.equal(await nara.getAttribute('aria-pressed'), 'true');
  assert.equal(await place_search.inputValue(), 'Nara test inn');
  assert.deepEqual(place_requests.at(-1), { city: 'Nara', query: 'Nara test inn' });
  await nara_inn.click();
  await dialog.getByText('Day 2 · Nara', { exact: true }).waitFor();
  assert.equal(await shellBack(), true);
  await kyoto.click();
  await search_in_nara.waitFor();
  assert.equal(await place_search.inputValue(), 'Nara test inn');
  await nara.click();
  await nara_inn.waitFor();
  await place_search.fill('Unavailable inn');
  await search.click();
  await dialog.getByRole('alert').waitFor();
  await dialog.getByRole('button', { name: 'Enter manually' }).click();
  assert.equal(await dialog.getByLabel('Stop name').inputValue(), 'Unavailable inn');
  assert.equal(await dialog.getByLabel('Category').inputValue(), 'stay');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await dialog.getByRole('button', { name: 'Discard changes' }).click();
  await add_hotel.click();
  await nara_inn.waitFor();
  const before_named = place_requests.length;
  await place_search.fill('est in');
  await nara_inn.waitFor();
  assert.equal(
    place_requests.length,
    before_named,
    'Partial names match already loaded nearby rows.',
  );
  await place_search.fill('no such inn');
  await dialog.getByText('No nearby matches.', { exact: false }).waitFor();
  assert.equal(await nara_inn.count(), 0);
  await dialog.getByRole('button', { name: 'Clear search' }).click();
  assert(await place_search.evaluate((input) => input === document.activeElement));
  await nara_inn.waitFor();
  await place_search.fill('test inn');
  assert.equal(place_requests.length, before_named, 'Typing a name waits for submit.');
  await search.click();
  await nara_inn.waitFor();
  assert.deepEqual(place_requests.at(-1), { city: 'Nara', query: 'test inn' });
  const after_named = place_requests.length;
  await kyoto.click();
  await dialog.getByRole('heading', { name: 'Hotels near Kyoto' }).waitFor();
  await dialog.getByRole('button', { name: /^Kyoto test inn/ }).waitFor();
  assert.equal(await place_search.inputValue(), '');
  await nara.click();
  await nara_inn.waitFor();
  assert.equal(await place_search.inputValue(), 'test inn');
  await sights.click();
  await nara_museum.waitFor();
  assert.equal(await place_search.inputValue(), '');
  await hotels.click();
  await nara_inn.waitFor();
  assert.equal(await place_search.inputValue(), 'test inn');
  assert.equal(
    place_requests.length,
    after_named,
    'Revisiting cities and categories uses their fresh results.',
  );

  let release_place!: () => void;
  pending_place = new Promise<void>((resolve) => {
    release_place = resolve;
  });
  await kyoto.click();
  await place_search.fill('Late inn');
  await search.click();
  await dialog.getByText('Searching…', { exact: true }).waitFor();
  assert.equal(await dialog.getByRole('button', { name: /^Choose stay dates for / }).count(), 0);
  await nara.click();
  await nara_inn.waitFor();
  assert.deepEqual(place_requests.at(-1), { city: 'Kyoto', query: 'Late inn' });
  release_place();
  pending_place = undefined;
  await dialog.getByRole('heading', { name: 'Hotels near Nara' }).waitFor();
  assert.equal(await place_search.inputValue(), 'test inn');
  await nara_inn.click();
  assert.equal(await dialog.getByLabel('Category').inputValue(), 'stay');
  await assertStayDates(day_two, '2030-05-22');
  await dialog.getByRole('button', { name: 'Change place', exact: true }).click();
  await nara_inn.waitFor();
  assert.equal(
    await dialog.getByRole('button', { name: /^Choose stay dates for / }).count(),
    0,
    'Replacing a place must return to the current draft.',
  );
  assert.equal(await hotels.getAttribute('aria-pressed'), 'true');
  assert.equal(await nara.getAttribute('aria-pressed'), 'true');
  assert.equal(await place_search.inputValue(), 'test inn');
  await page
    .locator('#applet')
    .screenshot({ path: resolve(qa_directory, 'native-transfer-place-search.png') });
  await nara_inn.click();
  await change_dates.click();
  await calendar.fill('2030-05-23');
  await apply_dates.click();
  const hotel_notes = 'Leave luggage before check-in.';
  await dialog.getByLabel('Notes').fill(hotel_notes);
  const before_preview = journal();
  const writes_before_preview = journal_writes;
  assert(!before_preview.stops.some((stop) => stop.title === 'Nara test inn'));
  assert.equal(
    http_urls.length,
    tiles_before_picking,
    'Searching and reviewing a place loads no map tiles.',
  );
  const view_on_map = dialog.getByRole('button', { name: 'View on map', exact: true });
  const map_preview = frame.getByRole('dialog', { name: 'Place map', exact: true });
  const preview_map = map_preview.getByRole('region', {
    name: 'Map of selected place and day stops',
  });
  const candidate_pin = preview_map.locator('[data-candidate-pin]');
  const review_after_map = async () => {
    await view_on_map.waitFor();
    assert(
      await view_on_map.evaluate((button) => document.activeElement === button),
      'Focus returns to the map action in the draft.',
    );
    assert.equal(await dialog.getByLabel('Stop name').inputValue(), 'Nara test inn');
    assert.equal(await dialog.getByLabel('Category').inputValue(), 'stay');
    await dialog.getByText('Day 2 · Nara', { exact: true }).waitFor();
    await assertStayDates(day_two, '2030-05-23');
    assert.equal(await dialog.getByLabel('Notes').inputValue(), hotel_notes);
    assert.deepEqual(journal(), before_preview);
    assert.equal(
      journal_writes,
      writes_before_preview,
      'Previewing and returning leave the journal untouched.',
    );
  };
  fail_map_tiles = true;
  await view_on_map.click();
  await candidate_pin.waitFor();
  await map_preview.getByRole('status').filter({ hasText: 'Map background unavailable' }).waitFor();
  assert(http_urls.length > tiles_before_picking, 'Opening the preview requests its basemap.');
  assert(
    http_urls
      .slice(tiles_before_picking)
      .every((href) => Number(new URL(href).pathname.split('/')[1]) > 8),
    'The first tiles should show the Nara itinerary at city scale.',
  );
  for (const [number, title] of [
    'JR Nara Station',
    'Nara Park',
    'Tōdai-ji',
    'Nara test museum',
  ].entries()) {
    const pin = preview_map.locator(`[data-stop-numbers="${number + 1}"]`);
    assert.equal(await pin.getAttribute('aria-label'), `Stop ${number + 1}, ${title}`);
  }
  assert.equal(await candidate_pin.getAttribute('aria-label'), 'Selected place, Nara test inn');
  fail_map_tiles = false;
  await map_preview.getByRole('button', { name: /^Retry/ }).click();
  await preview_map.locator('.leaflet-tile-loaded').first().waitFor();
  await map_preview
    .getByRole('status')
    .filter({ hasText: 'Map background unavailable' })
    .waitFor({ state: 'hidden' });
  await page
    .locator('#applet')
    .screenshot({ path: resolve(qa_directory, 'native-transfer-place-map.png') });
  assert.equal(await shellBack(), true, 'Native Back from the candidate map returns to the draft.');
  await review_after_map();
  await view_on_map.click();
  await candidate_pin.waitFor();
  await candidate_pin.click();
  const pin_popup = preview_map.locator('.leaflet-popup-content');
  await pin_popup.getByText('Selected place, Nara test inn', { exact: true }).waitFor();
  await preview_map.locator('[data-stop-numbers="4"]').click();
  await pin_popup.getByText('Stop 4, Nara test museum', { exact: true }).waitFor();
  await map_preview.getByRole('button', { name: 'Back to stop', exact: true }).click();
  await review_after_map();
  await page.locator('#applet').evaluate((element) => {
    element.style.width = '320px';
  });
  await dialog.evaluate(() => {
    document.documentElement.style.fontSize = '150%';
  });
  for (const action of [add_another, save_stop]) {
    assert(
      await action.evaluate((button) => {
        const label = document.createRange();
        label.selectNodeContents(button);
        const box = button.getBoundingClientRect();
        return Array.from(label.getClientRects()).every(
          (line) =>
            line.left >= box.left &&
            line.right <= box.right &&
            line.top >= box.top &&
            line.bottom <= box.bottom,
        );
      }),
      'Large save labels must wrap inside each separate touch target.',
    );
  }
  await dialog.evaluate(() => {
    document.documentElement.style.removeProperty('font-size');
  });
  await page.locator('#applet').evaluate((element) => {
    element.style.width = '390px';
  });
  await add_another.click();
  await nara_inn.getByText('On this day', { exact: true }).waitFor();
  assert.equal(await nara.getAttribute('aria-pressed'), 'true');
  assert.equal(await hotels.getAttribute('aria-pressed'), 'true');
  assert.equal(await place_search.inputValue(), 'test inn');
  assert.equal(await shellBack(), true, 'Back from the clean hotel picker finishes this session.');
  await dialog.waitFor({ state: 'hidden' });
  await assertReturnedToStop('Edit Nara test inn');
  assert.equal(journal_writes, writes_before_preview + 1);
  const saved_hotel = journal().stops.find((stop) => stop.title === 'Nara test inn');
  assert.equal(saved_hotel?.notes, hotel_notes);
  await day_map.click();
  if ((await map_order_toggle.getAttribute('aria-expanded')) === 'false')
    await map_order_toggle.click();
  await map_order.getByRole('button', { name: 'Edit Nara test inn', exact: true }).waitFor();
  await frame.locator('.map-route-line').first().waitFor();
  assert.equal(
    await frame.locator('[data-candidate-pin]').count(),
    0,
    'The saved route uses regular numbered pins.',
  );
  assert.equal(journal_writes, writes_before_preview + 1);

  // Reload the applet to empty its search caches, with packaged assets still
  // available through the local host as they are on the device when offline.
  await native_frame.goto(native_frame.url());
  await frame.getByRole('button', { name: 'Open trip Kansai by rail' }).click();
  await frame.getByRole('button', { name: 'Day 2, 21 May' }).click();
  await native_frame.evaluate(() => Object.defineProperty(navigator, 'onLine', { value: false }));
  const http_before_airport = calls.filter((method) => method === 'http.request').length;
  await add_stop.click();
  await dialog.getByRole('button', { name: 'Airports', exact: true }).click();
  await dialog.getByRole('searchbox', { name: 'Search airports' }).fill('KIX');
  await search.click();
  await dialog.getByRole('button', { name: /Kansai International Airport.*KIX/ }).click();
  assert.equal(await dialog.getByLabel('Category').inputValue(), 'transport');
  await save_stop.click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(calls.filter((method) => method === 'http.request').length, http_before_airport);
  const persisted = journal();
  const museum = persisted.stops.find((stop) => stop.title === 'Nara test museum');
  const inn = persisted.stops.find((stop) => stop.title === 'Nara test inn');
  const airport = persisted.stops.find((stop) => stop.title === 'Kansai International Airport');
  assert(museum?.directory_ref && museum.kind === 'sight');
  assert.equal(museum.day, day_two);
  assert.equal(museum.city, 'Nara');
  assert(
    inn && (inn.directory_ref?.provider === 'osm' || inn.directory_ref?.provider === 'geoapify'),
  );
  assert(airport?.directory_ref?.provider === 'ourairports');
  assert.deepEqual(inn.position, { latitude: 34.682, longitude: 135.828 });
  assert.equal(inn.day, day_two);
  assert.equal(inn.city, 'Nara');
  assert.equal(airport.city, undefined);
  assert.equal(inn.checkout_date, '2030-05-23');
  assert.equal(inn.directory_ref.subtitle, 'Nara');
  assert.equal(airport.day, inn.day);
  assert(airport.position);
  await native_frame.goto(native_frame.url());
  await frame.getByRole('button', { name: 'Open trip Kansai by rail' }).click();
  await frame.getByRole('button', { name: 'Day 2, 21 May' }).click();
  await frame.getByRole('button', { name: 'Edit Nara test museum' }).waitFor();
  const requests_before_edit = place_requests.length;
  await frame.getByRole('button', { name: 'Edit Nara test inn' }).click();
  await assertStayDates(day_two, '2030-05-23');
  assert.equal(place_requests.length, requests_before_edit, 'Opening a saved stop stays local.');
  await page.locator('#applet').evaluate((element) => {
    element.style.width = '320px';
  });
  for (const field of [
    change_dates,
    dialog.getByLabel('Time', { exact: true }),
    dialog.getByLabel('Category'),
  ]) {
    assert(
      await field.evaluate((input) => {
        const box = input.getBoundingClientRect();
        return box.width >= 44 && box.height >= 44 && box.right <= innerWidth;
      }),
      'Each compact schedule control must fit the viewport and have a full touch target.',
    );
  }
  assert(
    await save_stop.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      return button.contains(
        document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
      );
    }),
    'Save stays within reach while reviewing a hotel.',
  );
  await page.locator('#applet').evaluate((element) => {
    element.style.width = '390px';
  });
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await frame.getByRole('button', { name: 'Edit Kansai International Airport' }).click();
  assert.equal(
    await dialog.getByLabel('Stop latitude').inputValue(),
    String(airport.position.latitude),
  );
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  assert.deepEqual(journal(), persisted);
  await add_stop.click();
  await nara.click();
  await nara_museum.getByText('On this day', { exact: true }).waitFor();
  await nara_museum.click();
  const edit_planned = dialog.getByRole('button', { name: /^Edit planned visit/ });
  await edit_planned.waitFor();
  assert(await edit_planned.evaluate((button) => document.activeElement === button));
  assert.equal(await shellBack(), true);
  assert.equal(await nara_museum.getAttribute('aria-expanded'), 'false');
  assert(await nara_museum.evaluate((button) => document.activeElement === button));
  await nara_museum.click();
  await kyoto.click();
  await nara.click();
  await nara_museum.waitFor();
  assert.equal(await nara_museum.getAttribute('aria-expanded'), 'false');
  await nara_museum.click();
  await edit_planned.click();
  await frame.getByRole('dialog', { name: 'Edit stop' }).waitFor();
  assert.equal(
    await frame.getByRole('dialog', { name: 'Edit stop' }).getByLabel('Stop name').inputValue(),
    museum.title,
  );
  assert.equal(await shellBack(), true);
  await edit_planned.waitFor();
  assert.deepEqual(
    journal(),
    persisted,
    'Opening a scheduled visit keeps its record and itinerary intact.',
  );
  await dialog.getByRole('button', { name: 'Add another visit', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add to Day 2', exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  const discard_stop = dialog.getByRole('button', { name: 'Discard changes' });
  assert(
    await discard_stop.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      return button.contains(
        document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
      );
    }),
    'Discard must be reachable before any scrolling by the traveler or the test.',
  );
  await discard_stop.click();
  await frame.getByRole('button', { name: 'Day 3, 22 May' }).click();
  await add_hotel.click();
  await nara.click();
  await nara_inn.getByText('On this day', { exact: true }).waitFor();
  await nara_inn.click();
  await dialog.getByRole('button', { name: /^Edit planned stay/ }).click();
  const continuing_editor = frame.getByRole('dialog', { name: 'Edit hotel stay', exact: true });
  await assertStayDates(day_two, '2030-05-23', continuing_editor);
  await continuing_editor.getByRole('button', { name: 'Save changes' }).click();
  await continuing_editor.waitFor({ state: 'hidden' });
  assert.equal(await frame.getByLabel('Choose itinerary date').inputValue(), '2030-05-22');
  await assertReturnedToStop('Staying at Nara test inn');
  await frame.getByRole('button', { name: 'Staying at Nara test inn' }).click();
  await assertStayDates(day_two, '2030-05-23');
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await frame.getByRole('button', { name: 'Next day', exact: true }).click();
  await frame.getByRole('button', { name: 'Check out of Nara test inn' }).waitFor();
  assert.deepEqual(journal(), persisted);
  const writes_before_checkout_maps = journal_writes;
  await add_hotel.click();
  await nara.click();
  await nara_inn.waitFor();
  assert.equal(await nara_inn.getByText('On this day', { exact: true }).count(), 0);
  await sights.click();
  await nara_museum.waitFor();
  const open_results_map = frame.getByRole('button', { name: 'Map of results', exact: true });
  await open_results_map.click();
  const checkout_map = frame.getByRole('dialog', { name: 'Sights near Nara', exact: true });
  await checkout_map.getByRole('button', { name: 'Fit results and day route' }).click();
  const checkout_label = 'Check out of Nara test inn';
  const checkout_pin = checkout_map.getByRole('button', { name: checkout_label, exact: true });
  assert.equal(await checkout_pin.getAttribute('data-stop-numbers'), null);
  await checkout_pin.press('Enter');
  await checkout_map.getByText(checkout_label, { exact: true }).waitFor();
  await checkout_map
    .getByRole('button', { name: 'Show Nara National Museum on map' })
    .press('Enter');
  await checkout_map.getByText(/straight line to hotel · Nara test inn/).waitFor();
  await checkout_map.getByRole('button', { name: 'Review place' }).click();
  await view_on_map.click();
  const checkout_preview_pin = preview_map.getByRole('button', {
    name: checkout_label,
    exact: true,
  });
  assert.equal(await checkout_preview_pin.getAttribute('data-stop-numbers'), null);
  await checkout_preview_pin.press('Enter');
  await preview_map.getByText(checkout_label, { exact: true }).waitFor();
  await map_preview.getByText(/Closest hotel/).waitFor();
  assert.equal(await candidate_pin.getAttribute('aria-description'), 'Stop 1 of 1');
  for (const step of ['preview', 'review', 'result map', 'place list']) {
    assert.equal(await shellBack(), true, `Back from checkout-day ${step}.`);
  }
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(journal_writes, writes_before_checkout_maps);
  assert.deepEqual(journal(), persisted);
  await frame.getByRole('button', { name: 'Check out of Nara test inn' }).click();
  await dialog.getByLabel('Notes').fill('Arrive after dinner.');
  await dialog.getByRole('button', { name: 'Change place' }).click();
  await kyoto.click();
  await dialog.getByRole('button', { name: /^Kyoto test inn/ }).click();
  await save_stop.click();
  await dialog.waitFor({ state: 'hidden' });
  const updated_hotel = journal().stops.find((stop) => stop.id === inn.id);
  assert.equal(updated_hotel?.title, 'Kyoto test inn');
  assert.equal(updated_hotel.city, 'Kyoto');
  assert.equal(updated_hotel.day, inn.day);
  assert.equal(updated_hotel.checkout_date, inn.checkout_date);
  assert.equal(updated_hotel.notes, 'Arrive after dinner.');
  assert.equal(journal().stops.length, persisted.stops.length);
  await assertReturnedToStop('Check out of Kyoto test inn');
  await frame.getByRole('button', { name: 'Check out of Kyoto test inn' }).click();
  await dialog.getByRole('button', { name: 'Change place' }).click();
  assert.equal(await kyoto.getAttribute('aria-pressed'), 'true');
  assert.equal(await shellBack(), true);
  await dialog.getByRole('button', { name: 'Close dialog' }).click();

  // Pick an actual Kansai sight through the provider, insert it into a transfer day,
  // then move its saved record after linking a journal entry to it.
  await frame.getByRole('button', { name: 'Day 2, 21 May', exact: true }).click();
  const before_insert = journal();
  const museum_name = 'Nara National Museum';
  const route_position = dialog.getByRole('button', { name: 'Route position', exact: true });
  const position_sheet = frame.getByRole('dialog', { name: 'Route position', exact: true });
  const before_park = position_sheet.getByRole('button', {
    name: /^Position 2 of \d+, Before Nara Park$/,
  });
  const day_titles = (snapshot: Journal, selected_day: string) =>
    snapshot.stops
      .filter((stop) => stop.trip_id === 'example-kansai' && stop.day === selected_day)
      .map((stop) => stop.title);
  const planned_list = frame.getByRole('list', { name: 'Planned stops', exact: true });
  await add_stop.click();
  await kyoto_museum.waitFor();
  const sight_map = frame.getByRole('dialog', { name: 'Sights near Kyoto', exact: true });
  const result_pins = sight_map.getByRole('region', { name: 'Map of place results', exact: true });
  const results = dialog.getByRole('list', { name: 'Place results', exact: true });
  const sight_names = await results.locator('strong').allTextContents();
  assert.deepEqual([...sight_names].sort(), ['Kyoto history museum', 'Kyoto test museum']);
  const browse_requests = place_requests.length;
  const browse_writes = journal_writes;
  await open_results_map.click();
  const pin_for = (name: string) =>
    result_pins.getByRole('button', { name: `Show ${name} on map`, exact: true });
  // These two venues share one coordinate. Both must remain individually selectable.
  await pin_for(sight_names[0]).waitFor();
  assert.equal(await pin_for(sight_names[0]).getAttribute('aria-pressed'), 'true');
  const nara_route_pin = result_pins.getByRole('button', {
    name: 'Stop 2, Nara Park',
    exact: true,
  });
  const route_pin_in_view = () =>
    nara_route_pin.evaluate((pin) => {
      const view = pin.closest('[role="region"]')!.getBoundingClientRect();
      const target = pin.getBoundingClientRect();
      return (
        target.left >= view.left &&
        target.right <= view.right &&
        target.top >= view.top &&
        target.bottom <= view.bottom
      );
    });
  assert.equal(await route_pin_in_view(), false, 'Kyoto results open at city scale.');
  await sight_map.getByRole('button', { name: 'Fit results and day route', exact: true }).click();
  assert.equal(await route_pin_in_view(), true, 'The full day includes the other transfer city.');
  await sight_map.getByRole('button', { name: 'Fit search results', exact: true }).click();
  assert.equal(await route_pin_in_view(), false);
  assert.equal(await sight_map.getByRole('button', { name: 'Previous place' }).isDisabled(), true);
  await sight_map.getByRole('button', { name: 'Next place' }).click();
  assert.equal(await pin_for(sight_names[1]).getAttribute('aria-pressed'), 'true');
  assert.equal(await sight_map.getByRole('button', { name: 'Next place' }).isDisabled(), true);
  await sight_map.getByText(sight_names[1], { exact: true }).waitFor();
  await sight_map.getByRole('button', { name: 'Review place' }).click();
  assert.equal(await dialog.getByLabel('Stop name').inputValue(), sight_names[1]);
  await dialog.getByText('Day 2 · Kyoto', { exact: true }).waitFor();
  assert.equal(await shellBack(), true);
  await sight_map.getByText(sight_names[1], { exact: true }).waitFor();
  assert.equal(await pin_for(sight_names[1]).getAttribute('aria-pressed'), 'true');
  const reviewed_quick_add = `Add ${sight_names[1]} to day`;
  await sight_map.getByRole('button', { name: reviewed_quick_add, exact: true }).waitFor();
  await sight_map.getByRole('button', { name: 'Back to place list' }).click();
  await kyoto_museum.waitFor();
  await results.getByRole('button', { name: reviewed_quick_add, exact: true }).waitFor();
  assert.equal(await kyoto.getAttribute('aria-pressed'), 'true');
  assert.equal(place_requests.length, browse_requests);
  assert.equal(journal_writes, browse_writes);
  await open_results_map.click();
  await sight_map.getByRole('button', { name: 'Search in Nara', exact: true }).click();
  const nara_map = frame.getByRole('dialog', { name: 'Sights near Nara', exact: true });
  assert.equal(
    await nara_map.getByRole('button', { name: 'Search in Nara' }).getAttribute('aria-pressed'),
    'true',
  );
  const nara_pins = nara_map.getByRole('region', { name: 'Map of place results', exact: true });
  assert.equal(await nara_pins.getByRole('button', { name: /^Show Kyoto / }).count(), 0);
  await nara_pins.getByRole('button', { name: 'Stop 2, Nara Park', exact: true }).waitFor();
  const national_pin = nara_pins.getByRole('button', { name: `Show ${museum_name} on map` });
  await national_pin.click();
  await nara_map.getByText(museum_name, { exact: true }).waitFor();
  await nara_map
    .getByRole('group', { name: 'Selected place' })
    .getByText(/565 m straight line to stop 2 · Nara Park/)
    .waitFor();
  assert.equal(await national_pin.getAttribute('aria-pressed'), 'true');
  await page
    .locator('#applet')
    .screenshot({ path: resolve(qa_directory, 'native-sight-results-map.png') });
  assert.equal(await shellBack(), true);
  await nara_museum.waitFor();
  assert.equal(await nara.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(journal(), before_insert);
  await place_search.fill(museum_name);
  await search.click();
  await dialog.getByRole('button', { name: /^Nara National Museum/ }).click();
  await route_position.click();
  const last_slot = position_sheet.getByRole('button', { name: /^Position .*?, After / });
  assert.equal(await last_slot.getAttribute('aria-pressed'), 'true');
  await before_park.click();
  await route_position.click();
  assert.equal(await before_park.getAttribute('aria-pressed'), 'true');
  await page
    .locator('#applet')
    .screenshot({ path: resolve(qa_directory, 'native-transfer-position.png') });
  assert.equal(await shellBack(), true);
  await route_position.waitFor();
  assert.equal(await dialog.getByLabel('Stop name').inputValue(), museum_name);
  await view_on_map.click();
  await candidate_pin.waitFor();
  assert.equal(
    await candidate_pin.getAttribute('aria-description'),
    `Stop 2 of ${day_titles(before_insert, day_two).length + 1}`,
  );
  await preview_map.getByRole('button', { name: 'Stop 3, Nara Park', exact: true }).waitFor();
  await preview_map.locator('.map-route-line').first().waitFor();
  await map_preview.getByRole('button', { name: 'Back to stop', exact: true }).click();
  assert.deepEqual(journal(), before_insert, 'Selecting a position only edits the draft.');
  fail_next_write = true;
  await save_stop.click();
  await dialog.getByRole('alert').filter({ hasText: 'Simulated storage failure' }).waitFor();
  assert.deepEqual(journal(), before_insert);
  await route_position.click();
  assert.equal(
    await before_park.getAttribute('aria-pressed'),
    'true',
    'A failed save keeps the chosen slot.',
  );
  await position_sheet.getByRole('button', { name: 'Back to stop', exact: true }).click();
  await save_stop.click();
  await dialog.waitFor({ state: 'hidden' });
  const inserted = journal();
  await assertReturnedToStop(`Edit ${museum_name}`);
  const new_museum = inserted.stops.find((stop) => stop.title === museum_name);
  assert(new_museum?.directory_ref && new_museum.kind === 'sight' && new_museum.city === 'Nara');
  const expected_day = day_titles(before_insert, day_two);
  expected_day.splice(1, 0, museum_name);
  assert.deepEqual(day_titles(inserted, day_two), expected_day);
  assert.deepEqual(
    { ...inserted, stops: inserted.stops.filter((stop) => stop.id !== new_museum.id) },
    before_insert,
  );
  assert.deepEqual(
    await planned_list.getByRole('button', { name: /^Edit / }).allTextContents(),
    expected_day,
  );
  await day_map.click();
  if ((await map_order_toggle.getAttribute('aria-expanded')) === 'false')
    await map_order_toggle.click();
  await frame.getByRole('button', { name: 'Stop 2, Nara National Museum', exact: true }).waitFor();
  assert.deepEqual(
    await map_order
      .getByRole('button', { name: /^Edit / })
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label'))),
    expected_day.map((title) => 'Edit ' + title),
  );
  await mainView('Itinerary').click();
  await frame
    .getByRole('button', { name: 'Check in at Nara National Museum', exact: true })
    .click();
  await dialog.getByLabel('Visit date & time').fill(day_two + 'T13:00');
  await dialog.getByRole('button', { name: 'Save check-in', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const before_move = journal();
  assert(before_move.check_ins.some((entry) => entry.stop_id === new_museum.id));
  await native_frame.goto(native_frame.url());
  await frame.getByRole('button', { name: 'Open trip Kansai by rail', exact: true }).click();
  await frame.getByRole('button', { name: 'Day 2, 21 May', exact: true }).click();
  await planned_list
    .getByRole('button', { name: 'Edit Nara National Museum', exact: true })
    .click();
  await route_position.click();
  assert.equal(
    await before_park.getAttribute('aria-pressed'),
    'true',
    'Reopening an edit selects its saved slot.',
  );
  const first_slot = position_sheet.getByRole('button', {
    name: /^Position 1 of \d+, Before JR Nara Station$/,
  });
  await first_slot.click();
  assert.equal(await shellBack(), true);
  await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click();
  assert.deepEqual(
    journal(),
    before_move,
    'Back from a position-only edit protects the unsaved change.',
  );
  await route_position.click();
  assert.equal(await first_slot.getAttribute('aria-pressed'), 'true');
  await position_sheet.getByRole('button', { name: 'Back to stop', exact: true }).click();
  const day_three = '2030-05-22';
  await dialog.getByLabel('Day', { exact: true }).fill(day_three);
  await route_position.click();
  assert.equal(
    await last_slot.getAttribute('aria-pressed'),
    'true',
    'Changing the date uses the new day’s slots.',
  );
  await position_sheet
    .getByRole('button', { name: /^Position 2 of \d+, Before Osaka Castle$/ })
    .click();
  await save_stop.click();
  await dialog.waitFor({ state: 'hidden' });
  const after_move = journal();
  await assertReturnedToStop(`Edit ${museum_name}`);
  const expected_move = day_titles(before_move, day_three);
  expected_move.splice(1, 0, museum_name);
  assert.deepEqual(day_titles(after_move, day_three), expected_move);
  assert.deepEqual(day_titles(after_move, day_two), day_titles(before_insert, day_two));
  assert.deepEqual(
    after_move.stops.find((stop) => stop.id === new_museum.id),
    { ...new_museum, day: day_three },
  );
  assert.deepEqual(
    after_move.stops.filter((stop) => stop.id !== new_museum.id),
    before_insert.stops,
  );
  assert.deepEqual(after_move.check_ins, before_move.check_ins);
  assert.deepEqual(after_move.places, before_move.places);

  await frame.getByRole('button', { name: 'Day 2, 21 May', exact: true }).click();
  await add_stop.click();
  await nara.click();
  await place_search.fill('museum');
  await search.click();
  const history_museum = dialog.getByRole('button', { name: /^Nara history museum/ });
  await history_museum.click();
  await dialog.getByLabel('Notes').fill('Collect the audio guide.');
  await dialog.getByLabel('Time', { exact: true }).fill('11:30');
  await route_position.click();
  await before_park.click();
  const writes_before_series = journal_writes;
  fail_next_write = true;
  await add_another.click();
  await dialog.getByRole('alert').filter({ hasText: 'Simulated storage failure' }).waitFor();
  assert.deepEqual(journal(), after_move);
  assert.equal(await dialog.getByLabel('Stop name').inputValue(), 'Nara history museum');
  await add_another.click();
  await history_museum.getByText('On this day', { exact: true }).waitFor();
  assert.equal(await history_museum.getAttribute('aria-expanded'), 'false');
  assert.equal(await sights.getAttribute('aria-pressed'), 'true');
  assert.equal(await nara.getAttribute('aria-pressed'), 'true');
  assert.equal(await place_search.inputValue(), 'museum');
  const first_save = journal();
  assert.equal(journal_writes, writes_before_series + 1);
  const series = day_titles(after_move, day_two);
  series.splice(1, 0, 'Nara history museum');
  assert.deepEqual(day_titles(first_save, day_two), series);
  const history_stop = first_save.stops.find((stop) => stop.title === 'Nara history museum');
  assert.equal(history_stop?.notes, 'Collect the audio guide.');
  assert.equal(history_stop.time, '11:30');
  await dialog.getByRole('button', { name: /^Nara National Museum/ }).click();
  assert.equal(await dialog.getByLabel('Notes').inputValue(), '');
  assert.equal(await dialog.getByLabel('Time', { exact: true }).inputValue(), '');
  await route_position.click();
  assert.equal(await last_slot.getAttribute('aria-pressed'), 'true');
  await position_sheet.getByRole('button', { name: 'Back to stop', exact: true }).click();
  await save_stop.click();
  await dialog.waitFor({ state: 'hidden' });
  const second_save = journal();
  assert.equal(journal_writes, writes_before_series + 2);
  assert.deepEqual(day_titles(second_save, day_two), [...series, museum_name]);
  const next_stop = second_save.stops.find(
    (stop) => stop.day === day_two && stop.title === museum_name,
  );
  assert(next_stop);
  assert.deepEqual(next_stop.position, { latitude: 34.683, longitude: 135.838 });
  assert.deepEqual(
    { ...second_save, stops: second_save.stops.filter((stop) => stop.id !== next_stop.id) },
    first_save,
  );

  const quick_museum = dialog.getByRole('button', {
    name: 'Add Kyoto test museum to day',
    exact: true,
  });
  const quick_history = sight_map.getByRole('button', {
    name: 'Add Kyoto history museum to day',
    exact: true,
  });
  await add_stop.click();
  await quick_museum.waitFor();
  await hotels.click();
  await nara_inn.waitFor();
  assert.equal(await dialog.getByRole('button', { name: /^Add .+ to day$/ }).count(), 0);
  await sights.click();
  await nara.click();
  await nara_museum.waitFor();
  await kyoto.click();
  await place_search.fill('museum');
  await search.click();
  await kyoto_museum.waitFor();
  await quick_museum.waitFor();
  const writes_before_quick_add = journal_writes;
  fail_next_write = true;
  await quick_museum.click();
  await dialog.getByRole('alert').filter({ hasText: 'Simulated storage failure' }).waitFor();
  assert.deepEqual(journal(), second_save);
  await quick_museum.evaluate((button) => {
    const add = button as HTMLButtonElement;
    add.click();
    add.click();
  });
  await kyoto_museum.getByText('On this day', { exact: true }).waitFor();
  assert.equal(await quick_museum.count(), 0);
  await page
    .locator('#applet')
    .screenshot({ path: resolve(qa_directory, 'native-transfer-quick-add.png') });
  await open_results_map.click();
  await pin_for('Kyoto history museum').press('Enter');
  await quick_history.click();
  await sight_map.getByRole('group', { name: 'Selected place' }).getByText('On this day').waitFor();
  await sight_map.getByRole('button', { name: 'Back to place list' }).click();
  await dialog
    .getByRole('button', { name: /^Kyoto history museum/ })
    .getByText('On this day')
    .waitFor();
  assert.equal(await kyoto.getAttribute('aria-pressed'), 'true');
  assert.equal(await sights.getAttribute('aria-pressed'), 'true');
  assert.equal(await place_search.inputValue(), 'museum');
  assert.equal(journal_writes, writes_before_quick_add + 2);
  const saved_quickly = journal();
  const previous_ids = new Set(second_save.stops.map((stop) => stop.id));
  const new_sights = saved_quickly.stops.filter((stop) => !previous_ids.has(stop.id));
  assert.deepEqual(
    new_sights.map((stop) => [stop.title, stop.kind, stop.city, stop.day]),
    [
      ['Kyoto test museum', 'sight', 'Kyoto', day_two],
      ['Kyoto history museum', 'sight', 'Kyoto', day_two],
    ],
  );
  assert(new_sights.every((stop) => stop.directory_ref && stop.position));
  assert.deepEqual(
    { ...saved_quickly, stops: saved_quickly.stops.filter((stop) => previous_ids.has(stop.id)) },
    second_save,
  );
  await open_results_map.click();
  await sight_map.getByRole('button', { name: /^Edit planned visit/ }).click();
  assert.equal(await dialog.getByLabel('Stop name').inputValue(), sight_names[0]);
  assert.equal(await shellBack(), true);
  await sight_map.getByText(sight_names[0], { exact: true }).waitFor();
  assert.deepEqual(journal(), saved_quickly, 'Inspecting the mapped visit preserves the day.');
  assert.equal(await shellBack(), true);
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await assertReturnedToStop('Edit Kyoto history museum');

  await add_hotel.click();
  await place_search.fill('test inn');
  await search.click();
  await nara_inn.waitFor();
  const hotel_map = frame.getByRole('dialog', { name: 'Hotels near Nara', exact: true });
  await open_results_map.click();
  await hotel_map.getByText('Nara test inn', { exact: true }).waitFor();
  const review_hotel = hotel_map.getByRole('button', { name: 'Review place', exact: true });
  await review_hotel.click();
  const reviewed_hotel_name = 'Nara inn by the station';
  await dialog.getByLabel('Stop name').fill(reviewed_hotel_name);
  await dialog.getByLabel('Notes').fill('Ask about breakfast.');
  assert.equal(await shellBack(), true);
  await hotel_map.getByText('Nara test inn', { exact: true }).waitFor();
  await review_hotel.click();
  assert.equal(await dialog.getByLabel('Stop name').inputValue(), reviewed_hotel_name);
  assert.equal(await dialog.getByLabel('Notes').inputValue(), 'Ask about breakfast.');
  await assertStayDates(day_two, day_three);
  await change_dates.click();
  await arrival.click();
  await stay_dates.getByRole('button', { name: 'Choose ' + day_three, exact: true }).click();
  await apply_dates.click();
  await add_another.click();
  await dialog.getByRole('heading', { name: 'Hotels near Osaka', exact: true }).waitFor();
  await dialog.getByRole('button', { name: /^Osaka test inn/ }).waitFor();
  const osaka = dialog.getByRole('button', { name: 'Search in Osaka', exact: true });
  assert.equal(await osaka.getAttribute('aria-pressed'), 'true');
  assert.equal(await hotels.getAttribute('aria-pressed'), 'true');
  await dialog.getByText('Day 3', { exact: true }).waitFor();
  assert.deepEqual(
    (
      await dialog.getByRole('group', { name: 'Search city' }).getByRole('button').allInnerTexts()
    ).map((name) => name.trim()),
    ['Nara', 'Osaka'],
  );
  assert.equal(await place_search.inputValue(), '');
  await nara.click();
  assert.equal(await place_search.inputValue(), '', 'The previous day’s Nara search is cleared.');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await assertReturnedToStop(`Edit ${reviewed_hotel_name}`);
  const rescheduled_stay = journal().stops.find((stop) => stop.title === reviewed_hotel_name);
  assert.equal(rescheduled_stay?.day, day_three);
  assert.equal(rescheduled_stay.checkout_date, '2030-05-23');
  assert.equal(rescheduled_stay.city, 'Nara');

  // The broad first page omits the park. The type picker must query the provider,
  // share its scope with the map, and keep each transfer city's selection.
  const chooseType = async (surface: Locator, type: 'Sight' | 'Lodging', option: string) => {
    const label = type === 'Sight' ? 'Filter sights by type' : 'Filter lodging by type';
    await surface.getByRole('button', { name: label, exact: true }).click();
    const choices = frame.getByRole('dialog', { name: `${type} type`, exact: true });
    const option_inset = await choices
      .getByRole('group', { name: `${type} type` })
      .evaluate((group) => {
        const style = getComputedStyle(group);
        return Math.min(parseFloat(style.paddingInlineStart), parseFloat(style.paddingInlineEnd));
      });
    assert(
      option_inset >= 12,
      'Keep space on both sides of the filter options inside the app sheet.',
    );
    await choices.getByRole('button', { name: option, exact: true }).click();
    await choices.waitFor({ state: 'hidden' });
  };
  await frame.getByRole('button', { name: 'Day 2, 21 May', exact: true }).click();
  await add_stop.click();
  await kyoto_museum.waitFor();
  await nara.click();
  await nara_museum.waitFor();
  assert.equal(await results.getByText('Nara Canal Walk').count(), 0);
  const writes_before_filter = journal_writes;
  await chooseType(dialog, 'Sight', 'Parks & gardens');
  const garden_map = frame.getByRole('dialog', { name: 'Parks & gardens near Nara', exact: true });
  const garden = results.getByRole('button', { name: /^Nara Canal Walk/ });
  await garden.waitFor();
  assert.match(await garden.innerText(), /Park · Nara/);
  assert.deepEqual(await results.locator('strong').allTextContents(), ['Nara Canal Walk']);
  await place_search.fill('Canal');
  await search.click();
  await garden.waitFor();
  assert.equal(await results.getByText('Nara Canal Works').count(), 0);
  await open_results_map.click();
  await garden_map.getByText(/Park · Nara/).waitFor();
  await garden_map
    .getByRole('button', { name: 'Show Nara Canal Walk on map', exact: true })
    .waitFor();
  await page
    .locator('#applet')
    .screenshot({ path: resolve(qa_directory, 'native-nara-parks-map.png') });
  await garden_map.getByRole('button', { name: 'Review place', exact: true }).click();
  assert.equal(await dialog.getByLabel('Stop name').inputValue(), 'Nara Canal Walk');
  await dialog.getByText('Day 2 · Nara', { exact: true }).waitFor();
  assert.equal(await shellBack(), true);
  await garden_map.getByRole('button', { name: 'Search in Kyoto', exact: true }).click();
  await sight_map.getByText('Kyoto test museum', { exact: true }).waitFor();
  await chooseType(sight_map, 'Sight', 'Places of worship');
  const empty_map = frame.getByRole('dialog', {
    name: 'Places of worship near Kyoto',
    exact: true,
  });
  await empty_map.getByRole('status').filter({ hasText: /No / }).waitFor();
  await chooseType(empty_map, 'Sight', 'Museums & galleries');
  const museum_map = frame.getByRole('dialog', {
    name: 'Museums & galleries near Kyoto',
    exact: true,
  });
  await museum_map.getByRole('button', { name: 'Search in Nara', exact: true }).click();
  await garden_map.getByRole('button', { name: 'Back to place list' }).click();
  assert.equal(await place_search.inputValue(), 'Canal');
  await dialog.getByRole('button', { name: 'Clear search', exact: true }).click();
  const add_garden = results.getByRole('button', {
    name: 'Add Nara Canal Walk to day',
    exact: true,
  });
  await add_garden.click();
  await garden.getByText('On this day').waitFor();
  assert.equal(journal_writes, writes_before_filter + 1);
  const saved_garden = journal().stops.find((stop) => stop.title === 'Nara Canal Walk');
  assert(
    saved_garden?.day === day_two && saved_garden.city === 'Nara' && saved_garden.kind === 'sight',
  );
  assert.equal(saved_garden.directory_ref?.place_type, 'park');
  await hotels.click();
  await kyoto.click();
  await chooseType(dialog, 'Lodging', 'Guest houses');
  const guest = results.getByRole('button', { name: /^Kyoto East Annex/ });
  await guest.waitFor();
  assert.deepEqual(await results.locator('strong').allTextContents(), ['Kyoto East Annex']);
  await place_search.fill('Annex');
  await search.click();
  await guest.click();
  await assertStayDates(day_two, day_three);
  assert.equal(await shellBack(), true);
  await dialog.getByRole('heading', { name: 'Guest houses near Kyoto', exact: true }).waitFor();
  assert.equal(await place_search.inputValue(), 'Annex');
  await place_search.fill('Unavailable inn');
  await search.click();
  await dialog.getByRole('alert').waitFor();
  await dialog.getByRole('button', { name: 'Enter manually', exact: true }).click();
  assert.equal(await dialog.getByLabel('Stop name').inputValue(), 'Unavailable inn');
  assert.equal(await dialog.getByLabel('Category').inputValue(), 'stay');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click();
  assert.equal(
    journal_writes,
    writes_before_filter + 1,
    'Comparing types and fallback never write a second stop.',
  );
  // A relaunch drops the directory cache. The saved type still identifies the park
  // even when its name says nothing about its type and the provider is unavailable.
  fail_place_search = true;
  await native_frame.goto(native_frame.url());
  await frame.getByRole('button', { name: 'Open trip Kansai by rail', exact: true }).click();
  await frame.getByRole('button', { name: 'Day 2, 21 May', exact: true }).click();
  await add_stop.click();
  await nara.click();
  await chooseType(dialog, 'Sight', 'Parks & gardens');
  await dialog.getByRole('alert').waitFor();
  assert.equal(await place_search.inputValue(), '');
  const saved_parks = dialog.getByRole('list', { name: 'On this day', exact: true });
  await saved_parks
    .getByRole('button', { name: 'Edit planned stop Nara Canal Walk', exact: true })
    .click();
  assert.equal(await park_editor.getByLabel('Stop name').inputValue(), 'Nara Canal Walk');
  assert.equal(await shellBack(), true);
  assert.equal(await shellBack(), true);
  assert.equal(journal_writes, writes_before_filter + 1);
  fail_place_search = false;
  assert.equal(await shellBack(), true, 'Back from the trip itinerary returns to the library.');
  await frame.getByRole('heading', { name: 'Your trips', exact: true }).waitFor();
  assert.equal(await shellBack(), false);

  // Use the untouched legacy route. All three Day 2 records have coordinates but no city.
  const kansai_source = Bun.file(new URL('../fixtures/kansai.json', import.meta.url));
  files.set('journal/journal.json', [...(await kansai_source.bytes())]);
  const clean_kansai = journal();
  const nara_route = day_titles(clean_kansai, day_two);
  const writes_before_transfer = journal_writes;
  await native_frame.goto(native_frame.url());
  await frame.getByRole('button', { name: 'Open trip Kansai by rail', exact: true }).click();
  await frame.getByRole('button', { name: 'Day 2, 21 May', exact: true }).click();
  await add_stop.click();
  await place_search.fill('Canal Works');
  await search.click();
  const reviewed_sight = 'Kyoto Canal Works';
  await results.getByRole('button', { name: /^Kyoto Canal Works/ }).click();
  await route_position.click();
  assert.equal(
    await first_slot.getAttribute('aria-pressed'),
    'true',
    'Start the Kyoto sight before the Nara train arrival.',
  );
  await position_sheet.getByRole('button', { name: 'Back to stop', exact: true }).click();
  await view_on_map.click();
  await candidate_pin.waitFor();
  assert.equal(await candidate_pin.getAttribute('aria-description'), 'Stop 1 of 4');
  await preview_map.getByRole('button', { name: 'Stop 2, JR Nara Station', exact: true }).waitFor();
  await map_preview.getByRole('button', { name: 'Back to stop', exact: true }).click();
  assert.deepEqual(journal(), clean_kansai);
  await save_stop.click();
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(day_titles(journal(), day_two), [reviewed_sight, ...nara_route]);

  await add_stop.click();
  await quick_museum.click();
  await kyoto_museum.getByText('On this day', { exact: true }).waitFor();
  await dialog
    .getByRole('status')
    .getByText('Kyoto test museum added to Day 2 before JR Nara Station.', { exact: true })
    .waitFor();
  const quick_sights = [reviewed_sight, 'Kyoto test museum', 'Kyoto history museum'];
  assert.deepEqual(day_titles(journal(), day_two), [
    reviewed_sight,
    'Kyoto test museum',
    ...nara_route,
  ]);
  await open_results_map.click();
  await pin_for('Kyoto history museum').press('Enter');
  await quick_history.click();
  await sight_map.getByRole('group', { name: 'Selected place' }).getByText('On this day').waitFor();
  const route_confirmation = sight_map
    .getByRole('status')
    .filter({ hasText: 'Kyoto history museum added to Day 2 before JR Nara Station.' });
  await route_confirmation.waitFor();
  const confirmation_size = await route_confirmation.boundingBox();
  assert(
    confirmation_size && confirmation_size.height >= 12,
    'Show the placement on the map card.',
  );
  await page
    .locator('#applet')
    .screenshot({ path: resolve(qa_directory, 'native-transfer-insertion.png') });
  assert.deepEqual(day_titles(journal(), day_two), [...quick_sights, ...nara_route]);
  await sight_map.getByRole('button', { name: 'Back to place list', exact: true }).click();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(await planned_list.getByRole('button', { name: /^Edit / }).allTextContents(), [
    ...quick_sights,
    ...nara_route,
  ]);

  // An overnight stay remains at the end even when searched in the departure city.
  await add_hotel.click();
  await kyoto.click();
  await dialog.getByRole('button', { name: /^Kyoto test inn/ }).click();
  await route_position.click();
  assert.equal(await last_slot.getAttribute('aria-pressed'), 'true');
  await position_sheet.getByRole('button', { name: 'Back to stop', exact: true }).click();
  // Book the arrival-city inn to leave the legacy route in chronological city order.
  await dialog.getByRole('button', { name: 'Change place', exact: true }).click();
  await nara.click();
  await nara_inn.click();
  await dialog.getByLabel('Notes').fill('Ask about a luggage locker.');
  await choose_stay_dates.click();
  await cancel_dates.click();
  assert.equal(await dialog.getByLabel('Notes').inputValue(), 'Ask about a luggage locker.');
  await choose_stay_dates.click();
  await stay_dates.getByText('Nara test inn', { exact: true }).waitFor();
  await confirm_stay.click();
  await stay_dates.waitFor({ state: 'hidden' });
  await dialog.waitFor({ state: 'hidden' });
  const route_with_stay = [...quick_sights, ...nara_route, 'Nara test inn'];
  assert.deepEqual(day_titles(journal(), day_two), route_with_stay);
  assert.equal(
    journal().stops.find((stop) => stop.title === 'Nara test inn')?.notes,
    'Ask about a luggage locker.',
  );

  // A traveler can place a departure-city sight last and edit it there on a later visit.
  const manual_sight = 'Kyoto Canal Walk';
  await add_stop.click();
  await place_search.fill('Canal Walk');
  await search.click();
  await results.getByRole('button', { name: /^Kyoto Canal Walk/ }).click();
  await route_position.click();
  const route_slots = position_sheet.getByRole('list', { name: 'Positions in this day' });
  assert.deepEqual(await route_slots.getByRole('heading').allTextContents(), [
    'Kyoto stops',
    'Nara stops',
  ]);
  assert.equal(
    await position_sheet
      .getByRole('button', { name: 'Position 4 of 8, Before JR Nara Station', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  await last_slot.click();
  await save_stop.click();
  await dialog.waitFor({ state: 'hidden' });
  await native_frame.goto(native_frame.url());
  await frame.getByRole('button', { name: 'Open trip Kansai by rail', exact: true }).click();
  await frame.getByRole('button', { name: 'Day 2, 21 May', exact: true }).click();
  await planned_list.getByRole('button', { name: 'Edit ' + manual_sight, exact: true }).click();
  await route_position.click();
  assert.equal(await last_slot.getAttribute('aria-pressed'), 'true');
  await position_sheet.getByRole('button', { name: 'Back to stop', exact: true }).click();
  await dialog.getByLabel('Notes').fill('Meet at the west gate.');
  await save_stop.click();
  await dialog.waitFor({ state: 'hidden' });
  const final_route = journal();
  assert.equal(journal_writes, writes_before_transfer + 6);
  assert.deepEqual(day_titles(final_route, day_two), [...route_with_stay, manual_sight]);
  const fixture_ids = new Set(clean_kansai.stops.map((stop) => stop.id));
  assert.deepEqual(
    final_route.stops.filter((stop) => fixture_ids.has(stop.id)),
    clean_kansai.stops,
  );

  // A traveler can submit a manual stop before the bundled city lookup finishes.
  const nara_shard = `**/directory/cities-${directoryShard('nara')}.json.gz`;
  let release_directory!: () => void;
  const pending_directory = new Promise<void>((resolve) => {
    release_directory = resolve;
  });
  await page.route(
    nara_shard,
    async (route) => {
      await pending_directory;
      await route.continue();
    },
    { times: 1 },
  );
  const writes_before_manual = journal_writes;
  const manual_title = 'Kyoto morning walk';
  try {
    files.set('journal/journal.json', [...(await kansai_source.bytes())]);
    await native_frame.goto(native_frame.url());
    await frame.getByRole('button', { name: 'Open trip Kansai by rail', exact: true }).click();
    await frame.getByRole('button', { name: 'Day 2, 21 May', exact: true }).click();
    await add_stop.click();
    await dialog.getByRole('button', { name: 'Enter manually', exact: true }).click();
    await dialog.getByLabel('Stop name').fill(manual_title);
    await route_position.getByText('Finding route position…', { exact: true }).waitFor();
    await save_stop.click();
    await dialog.getByRole('button', { name: 'Saving…', exact: true }).waitFor();
    assert.equal(journal_writes, writes_before_manual);
  } finally {
    release_directory();
  }
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(journal_writes, writes_before_manual + 1);
  assert.deepEqual(day_titles(journal(), day_two), [manual_title, ...nara_route]);

  // Reuse a journal with an overnight stay, a linked check-in and stops on other days.
  const initial_route = before_move.stops
    .filter((stop) => stop.trip_id === 'example-kansai' && stop.day === day_two)
    .map((stop, index) => (index === 0 ? { ...stop, time: '09:40', position: null } : stop));
  const timed_stop = initial_route[0];
  const booked_stay = initial_route.find((stop) => stop.checkout_date)!;
  assert(booked_stay && before_move.check_ins.some((entry) => entry.stop_id === new_museum.id));
  const reorder_fixture = {
    ...before_move,
    stops: before_move.stops.map((stop) => (stop.id === timed_stop.id ? timed_stop : stop)),
  };
  files.set('journal/journal.json', [...new TextEncoder().encode(JSON.stringify(reorder_fixture))]);
  await native_frame.goto(native_frame.url());
  await frame.getByRole('button', { name: 'Open trip Kansai by rail', exact: true }).click();
  await frame.getByRole('button', { name: 'Day 2, 21 May', exact: true }).click();

  const open_reorder = frame.getByRole('button', { name: 'Reorder stops', exact: true });
  const reorder_sheet = frame.getByRole('dialog', { name: 'Reorder stops', exact: true });
  const order_list = reorder_sheet.getByRole('list', { name: 'Stop order', exact: true });
  const draft_map = reorder_sheet.getByRole('region', { name: 'Draft route map', exact: true });
  const moveGrip = (title: string) =>
    order_list.getByRole('button', { name: 'Move ' + title, exact: true });
  async function chooseSlot(title: string, slot: number) {
    await moveGrip(title).click();
    await position_sheet
      .getByRole('button', { name: new RegExp(`^Position ${slot} of \\d+, (Before|After) `) })
      .click();
    await position_sheet.waitFor({ state: 'hidden' });
    await moveGrip(title).and(reorder_sheet.locator(':focus')).waitFor();
  }
  const original_titles = initial_route.map((stop) => stop.title);
  const gripTitles = () =>
    order_list
      .getByRole('button', { name: /^Move / })
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute('aria-label')!.slice('Move '.length)),
      );
  const writes_before_reorder = journal_writes;
  await open_reorder.click();
  assert.deepEqual(await gripTitles(), original_titles);
  await draft_map
    .getByRole('button', { name: 'Stop 2, ' + initial_route[1].title, exact: true })
    .waitFor();
  assert.equal(await draft_map.getByRole('button', { name: /Stop 1, / }).count(), 0);
  await chooseSlot(timed_stop.title, 3);
  assert.deepEqual(await gripTitles(), [
    original_titles[1],
    original_titles[2],
    original_titles[0],
    ...original_titles.slice(3),
  ]);
  await reorder_sheet.getByRole('button', { name: 'Cancel', exact: true }).click();
  await reorder_sheet.waitFor({ state: 'hidden' });
  assert.deepEqual(journal(), reorder_fixture);
  await open_reorder.click();
  await chooseSlot(booked_stay.title, 1);
  assert.equal(await shellBack(), true);
  await reorder_sheet.waitFor({ state: 'hidden' });
  assert.equal(
    journal_writes,
    writes_before_reorder,
    'Both ways of abandoning the draft leave storage untouched.',
  );

  await day_map.click();
  if ((await map_order_toggle.getAttribute('aria-expanded')) === 'false')
    await map_order_toggle.click();
  await optimize.click();
  await optimizer
    .getByRole('heading', { name: 'Stops needing map coordinates', exact: true })
    .waitFor();
  await optimizer.getByText(timed_stop.title, { exact: true }).waitFor();
  await optimizer.getByRole('button', { name: 'Close', exact: true }).click();
  await open_reorder.click();
  assert.deepEqual(await gripTitles(), original_titles);
  const start = await moveGrip(timed_stop.title).boundingBox();
  const target = await moveGrip(initial_route[2].title).boundingBox();
  assert(start && target && start.width >= 44 && start.height >= 44);
  const mouse = page.mouse;
  const dragAcross = async () => {
    await mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await mouse.down();
    await mouse.move(target.x + target.width / 2, target.y + target.height * 0.8, { steps: 14 });
    await order_list
      .getByRole('listitem')
      .nth(2)
      .getByRole('button', { name: 'Move ' + timed_stop.title, exact: true })
      .waitFor();
  };
  await dragAcross();
  await page.keyboard.press('Escape');
  await mouse.up();
  assert.deepEqual(
    await gripTitles(),
    original_titles,
    'Cancelling a drag restores its starting order.',
  );
  // A quick touch flick can report its destination only at pointerup in WebKit.
  await mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await mouse.down();
  await order_list.evaluate(() =>
    window.addEventListener('pointermove', (event) => event.stopImmediatePropagation(), {
      capture: true,
      once: true,
    }),
  );
  await mouse.move(target.x + target.width / 2, target.y + target.height * 0.8);
  await mouse.up();
  assert.equal(
    (await gripTitles())[2],
    timed_stop.title,
    'Use the release position even without a delivered pointermove.',
  );
  await chooseSlot(timed_stop.title, 1);
  await dragAcross();
  await mouse.up();
  await chooseSlot(booked_stay.title, 2);
  const arranged = [
    initial_route[1],
    booked_stay,
    initial_route[2],
    timed_stop,
    ...initial_route.slice(3).filter((stop) => stop.id !== booked_stay.id),
  ];
  const arranged_titles = arranged.map((stop) => stop.title);
  assert.deepEqual(await gripTitles(), arranged_titles);
  await draft_map
    .getByRole('button', { name: 'Stop 1, ' + arranged_titles[0], exact: true })
    .waitFor();
  assert.equal(
    await draft_map.getByRole('button', { name: /Stop 4, / }).count(),
    0,
    'The unlocated stop retains its number in the list.',
  );
  assert.deepEqual(journal(), reorder_fixture, 'Dragging and tapping only change the draft.');
  await page
    .locator('#applet')
    .screenshot({ path: resolve(qa_directory, 'native-reorder-stops.png') });
  const finish_reorder = reorder_sheet.getByRole('button', { name: 'Done', exact: true });
  fail_next_write = true;
  await finish_reorder.click();
  await reorder_sheet.getByRole('alert').filter({ hasText: 'Simulated storage failure' }).waitFor();
  assert.deepEqual(journal(), reorder_fixture);
  assert.deepEqual(await gripTitles(), arranged_titles);
  await finish_reorder.click();
  await reorder_sheet.waitFor({ state: 'hidden' });
  let route_index = 0;
  assert.deepEqual(journal(), {
    ...reorder_fixture,
    stops: reorder_fixture.stops.map((stop) =>
      stop.trip_id === 'example-kansai' && stop.day === day_two ? arranged[route_index++] : stop,
    ),
  });
  assert.equal(journal_writes, writes_before_reorder + 1);
  assert.deepEqual(
    await map_order
      .getByRole('button', { name: /^Edit / })
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute('aria-label')!.slice('Edit '.length)),
      ),
    arranged_titles,
  );
  await frame.getByRole('button', { name: 'Stop 1, ' + arranged_titles[0], exact: true }).waitFor();
  await native_frame.goto(native_frame.url());
  await frame.getByRole('button', { name: 'Open trip Kansai by rail', exact: true }).click();
  await frame.getByRole('button', { name: 'Day 2, 21 May', exact: true }).click();
  assert.deepEqual(
    await planned_list.getByRole('button', { name: /^Edit / }).allTextContents(),
    arranged_titles,
  );
  await frame.getByRole('button', { name: 'Day 3, 22 May', exact: true }).click();
  await frame
    .getByRole('button', { name: 'Staying at ' + booked_stay.title, exact: true })
    .waitFor();
  await open_reorder.click();
  assert.deepEqual(
    await gripTitles(),
    day_titles(reorder_fixture, day_three),
    'A continuing hotel stay has no numbered slot.',
  );
  await reorder_sheet.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(journal_writes, writes_before_reorder + 1);

  // Move the existing two-night Kyoto booking onto the Nara–Osaka transfer.
  files.set('journal/journal.json', [...new TextEncoder().encode(JSON.stringify(before_move))]);
  await native_frame.goto(native_frame.url());
  await frame.getByRole('button', { name: 'Open trip Kansai by rail', exact: true }).click();
  await frame.getByRole('button', { name: 'Day 2, 21 May', exact: true }).click();
  const old_stay = before_move.stops.find((stop) => stop.id === booked_stay.id)!;
  const writes_before_dates = journal_writes;
  const change_hotel = dialog.getByRole('button', { name: 'Change place', exact: true });
  await planned_list.getByRole('button', { name: 'Edit ' + old_stay.title, exact: true }).click();
  await change_dates.click();
  const transfer_date = stay_dates.getByRole('button', {
    name: 'Choose ' + day_three,
    exact: true,
  });
  assert.match(await transfer_date.innerText(), /Nara\s*→\s*Osaka/);
  await arrival.click();
  await transfer_date.click();
  assert.equal(await calendar.inputValue(), '2030-05-24');
  await page
    .locator('#applet')
    .screenshot({ path: resolve(qa_directory, 'native-transfer-stay-dates.png') });
  assert.equal(await shellBack(), true);
  await assertStayDates(day_two, '2030-05-23');
  assert.deepEqual(journal(), before_move);

  await change_dates.click();
  await arrival.click();
  await transfer_date.click();
  await apply_dates.click();
  await dialog.getByText('Day 3 · Kyoto', { exact: true }).waitFor();
  assert.equal(await dialog.getByLabel('Stop name').inputValue(), old_stay.title);
  const date_summary = await change_dates.evaluate(
    (button) => document.getElementById(button.getAttribute('aria-describedby')!)?.textContent,
  );
  assert.match(date_summary ?? '', /Day 3.*2 nights/);
  assert.equal(journal_writes, writes_before_dates);
  await assertStayDates(day_three, '2030-05-24');
  await change_hotel.click();
  await dialog.getByRole('heading', { name: 'Hotels near Osaka', exact: true }).waitFor();
  assert.equal(await kyoto.count(), 0);
  await dialog.getByRole('button', { name: /^Osaka test inn/ }).click();
  assert.equal(await dialog.getByLabel('Notes').inputValue(), old_stay.notes);
  await assertStayDates(day_three, '2030-05-24');
  fail_next_write = true;
  await save_stop.click();
  await dialog.getByRole('alert').filter({ hasText: 'Simulated storage failure' }).waitFor();
  assert.deepEqual(journal(), before_move);
  await assertStayDates(day_three, '2030-05-24');
  await save_stop.click();
  await dialog.waitFor({ state: 'hidden' });
  const moved_journal = journal();
  const moved_stay = moved_journal.stops.find((stop) => stop.id === old_stay.id)!;
  assert.equal(journal_writes, writes_before_dates + 1);
  assert.equal(moved_stay.title, 'Osaka test inn');
  assert.equal(moved_stay.city, 'Osaka');
  assert.equal(moved_stay.day, day_three);
  assert.equal(moved_stay.checkout_date, '2030-05-24');
  assert.equal(moved_stay.notes, old_stay.notes);
  assert.deepEqual(moved_stay.position, { latitude: 34.694, longitude: 135.502 });
  assert.deepEqual(
    moved_journal.stops.filter((stop) => stop.id !== old_stay.id),
    before_move.stops.filter((stop) => stop.id !== old_stay.id),
  );
  assert.deepEqual(moved_journal.check_ins, before_move.check_ins);

  await native_frame.goto(native_frame.url());
  await frame.getByRole('button', { name: 'Open trip Kansai by rail', exact: true }).click();
  await frame.getByRole('button', { name: 'Day 3, 22 May', exact: true }).click();
  await planned_list.getByRole('button', { name: 'Edit Osaka test inn', exact: true }).waitFor();
  await frame.getByRole('button', { name: 'Next day', exact: true }).click();
  await frame.getByRole('button', { name: 'Staying at Osaka test inn', exact: true }).waitFor();
  await frame.getByRole('button', { name: 'Next day', exact: true }).click();
  await frame.getByRole('button', { name: 'Check out of Osaka test inn', exact: true }).waitFor();
  await day_map.click();
  await frame
    .getByRole('button', { name: 'Check out of Osaka test inn', exact: true })
    .first()
    .waitFor();
  await mainView('Itinerary').click();
  await frame.getByRole('button', { name: 'Day 2, 21 May', exact: true }).click();
  assert.equal(
    await planned_list.getByRole('button', { name: 'Edit ' + old_stay.title, exact: true }).count(),
    0,
  );

  // A sight's original city is absent on its new date. Back must search the new day.
  await add_stop.click();
  await place_search.fill('Canal Walk');
  await search.click();
  await results.getByRole('button', { name: /^Kyoto Canal Walk/ }).click();
  await dialog.getByLabel('Day', { exact: true }).fill(day_three);
  assert.equal(await shellBack(), true);
  await dialog.getByText('Day 3', { exact: true }).waitFor();
  await dialog.getByRole('heading', { name: 'Sights near Nara', exact: true }).waitFor();
  assert.equal(await kyoto.count(), 0);
  assert.equal(await place_search.inputValue(), '');
  await nara_museum.click();
  await dialog.getByRole('button', { name: 'Add to Day 3', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const rebased_sight = journal().stops.find(
    (stop) => stop.title === 'Nara test museum' && stop.day === day_three,
  );
  assert.equal(rebased_sight?.city, 'Nara');
  assert.equal(journal_writes, writes_before_dates + 2);

  await frame.getByRole('button', { name: 'Day 2, 21 May', exact: true }).click();
  await add_hotel.click();
  await place_search.fill('test inn');
  await search.click();
  await nara_inn.click();
  await dialog.getByLabel('Stop name').fill('Nara station booking');
  await change_dates.click();
  await arrival.click();
  await transfer_date.click();
  await apply_dates.click();
  await dialog.getByRole('button', { name: 'Back to place results', exact: true }).click();
  await dialog.getByText('Day 3', { exact: true }).waitFor();
  await dialog.getByRole('heading', { name: 'Hotels near Nara', exact: true }).waitFor();
  assert.equal(await kyoto.count(), 0);
  assert.equal(await nara.getAttribute('aria-pressed'), 'true');
  assert.equal(await place_search.inputValue(), '');
  await nara_inn.click();
  assert.equal(await dialog.getByLabel('Stop name').inputValue(), 'Nara station booking');
  await assertStayDates(day_three, '2030-05-23');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click();
  assert.equal(journal_writes, writes_before_dates + 2);

  // Use directory-backed cities to verify the saved booking keeps its selected city ID.
  const city_locations = [
    { id: 'geonames:1857910', country_code: 'JP', latitude: 35.011, longitude: 135.768 },
    { id: 'geonames:1855612', country_code: 'JP', latitude: 34.682, longitude: 135.828 },
    { id: 'geonames:1853909', country_code: 'JP', latitude: 34.694, longitude: 135.502 },
  ];
  const booking_fixture = {
    ...clean_kansai,
    trips: [{ ...clean_kansai.trips[0], city_locations }],
  };
  files.set('journal/journal.json', [...new TextEncoder().encode(JSON.stringify(booking_fixture))]);
  await native_frame.goto(native_frame.url());
  await frame.getByRole('button', { name: 'Open trip Kansai by rail', exact: true }).click();
  await frame.getByRole('button', { name: 'Day 2, 21 May', exact: true }).click();
  await add_hotel.click();
  const schedule = (surface: Locator, title: string) =>
    surface.getByRole('button', { name: 'Choose stay dates for ' + title, exact: true });
  const writes_before_booking = journal_writes;
  await chooseType(dialog, 'Lodging', 'Guest houses');
  await place_search.fill('Annex');
  await search.click();
  const nara_guest = 'Nara East Annex';
  const list_schedule = schedule(dialog, nara_guest);
  await list_schedule.click();
  await stay_dates.getByText(nara_guest, { exact: true }).waitFor();
  await stay_dates.getByText('Nara', { exact: true }).waitFor();
  assert.equal(await calendar.inputValue(), day_three);
  await stay_dates.getByRole('button', { name: 'Set check-out later', exact: true }).click();
  assert.equal(await shellBack(), true);
  await list_schedule.and(dialog.locator(':focus')).waitFor();
  assert.equal(await place_search.inputValue(), 'Annex');
  assert.equal(journal_writes, writes_before_booking);
  await list_schedule.click();
  assert.equal(
    await calendar.inputValue(),
    day_three,
    'Cancelling leaves the default dates intact.',
  );
  await stay_dates.getByRole('button', { name: 'Set check-out later', exact: true }).click();
  fail_next_write = true;
  await confirm_stay.click();
  await stay_dates.getByRole('alert').filter({ hasText: 'Simulated storage failure' }).waitFor();
  assert.equal(await calendar.inputValue(), '');
  assert.deepEqual(journal(), booking_fixture);
  let release_booking!: () => void;
  pending_write = new Promise<void>((resolve) => {
    release_booking = resolve;
  });
  try {
    await confirm_stay.evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await stay_dates.getByRole('button', { name: 'Saving…', exact: true }).waitFor();
    assert.equal(await shellBack(), true);
    assert.equal(await stay_dates.isVisible(), true);
    assert.equal(journal_writes, writes_before_booking);
  } finally {
    pending_write = undefined;
    release_booking();
  }
  await stay_dates.waitFor({ state: 'hidden' });
  const saved_guest = results.getByRole('button', { name: /^Nara East Annex/ });
  await saved_guest.getByText('On this day', { exact: true }).waitFor();
  await saved_guest.and(dialog.locator(':focus')).waitFor();
  assert.equal(await list_schedule.count(), 0);
  await dialog.getByRole('heading', { name: 'Guest houses near Nara', exact: true }).waitFor();

  await kyoto.click();
  await chooseType(dialog, 'Lodging', 'Hostels');
  await place_search.fill('Annex');
  await search.click();
  await open_results_map.click();
  const kyoto_hostel = 'Kyoto West Annex';
  const hostels_map = frame.getByRole('dialog', { name: 'Hostels near Kyoto', exact: true });
  const map_schedule = schedule(hostels_map, kyoto_hostel);
  await map_schedule.click();
  await stay_dates.getByText(kyoto_hostel, { exact: true }).waitFor();
  await stay_dates.getByText('Kyoto', { exact: true }).waitFor();
  await cancel_dates.click();
  await map_schedule.and(hostels_map.locator(':focus')).waitFor();
  await map_schedule.click();
  await confirm_stay.click();
  await stay_dates.waitFor({ state: 'hidden' });
  const hostel_card = hostels_map.getByRole('group', { name: 'Selected place', exact: true });
  await hostel_card.getByText('On this day', { exact: true }).waitFor();
  await hostel_card
    .getByRole('heading', { name: kyoto_hostel, exact: true })
    .and(hostels_map.locator(':focus'))
    .waitFor();
  assert.equal(await map_schedule.count(), 0);
  await chooseType(hostels_map, 'Lodging', 'Guest houses');
  const guest_map = frame.getByRole('dialog', { name: 'Guest houses near Kyoto', exact: true });
  const kyoto_guest = 'Kyoto East Annex';
  await schedule(guest_map, kyoto_guest).click();
  await arrival.click();
  await transfer_date.click();
  assert.equal(await calendar.inputValue(), '2030-05-23');
  await page
    .locator('#applet')
    .screenshot({ path: resolve(qa_directory, 'native-hotel-result-dates.png') });
  await confirm_stay.click();
  await stay_dates.waitFor({ state: 'hidden' });
  await guest_map.waitFor({ state: 'hidden' });
  await dialog.getByRole('heading', { name: 'Hotels near Osaka', exact: true }).waitFor();
  assert.equal(await osaka.getAttribute('aria-pressed'), 'true');
  assert.equal(await place_search.inputValue(), '');

  const bookings = journal().stops.filter((stop) => stop.kind === 'stay');
  assert.equal(journal_writes, writes_before_booking + 3);
  assert.deepEqual(
    bookings.map((stop) => [
      stop.title,
      stop.city,
      stop.city_id,
      stop.day,
      stop.checkout_date,
      stop.directory_ref?.place_type,
    ]),
    [
      [nara_guest, 'Nara', city_locations[1].id, day_two, undefined, 'guest_house'],
      [kyoto_hostel, 'Kyoto', city_locations[0].id, day_two, day_three, 'hostel'],
      [kyoto_guest, 'Kyoto', city_locations[0].id, day_three, '2030-05-23', 'guest_house'],
    ],
  );
  for (const [index, stop] of bookings.entries()) {
    const ref = stop.directory_ref!;
    const fixture_id = [114, 107, 106][index];
    assert.equal(ref.id, ref.provider === 'osm' ? 'N' + fixture_id : 'fixture-' + fixture_id);
    assert.equal(ref.subtitle, stop.city);
  }

  // The Osaka result also opens full review. Its untouched dates are confirmed before saving.
  await dialog.getByRole('button', { name: /^Osaka test inn/ }).click();
  await dialog.getByLabel('Notes').fill('Request a quiet room.');
  await add_another.click();
  await stay_dates.getByText('Osaka test inn', { exact: true }).waitFor();
  await confirm_stay.click();
  await stay_dates.waitFor({ state: 'hidden' });
  await dialog.getByRole('heading', { name: 'Hotels near Osaka', exact: true }).waitFor();
  assert.equal(
    journal().stops.find((stop) => stop.title === 'Osaka test inn')?.notes,
    'Request a quiet room.',
  );
  assert.equal(journal_writes, writes_before_booking + 4);
  assert.deepEqual(errors, [], 'The native applet should not produce uncaught browser errors.');
  for (const method of [
    'photos.pick',
    'camera.capture',
    'location.current',
    'fs.write',
    'fs.read',
    'fs.stat',
    'http.request',
    'llm.config',
    'llm.generate',
  ]) {
    assert(calls.includes(method), `The applet should exercise ${method}.`);
  }
  console.log(
    JSON.stringify(
      {
        opaque_origin: 'null',
        entries: saved.check_ins.length,
        imported_events: imported.length,
        photos: saved.check_ins.reduce((count, entry) => count + entry.photos.length, 0),
        verified: [
          'production CSP and SDK handshake',
          'native Back through modal and nested views, dirty drafts, pending saves and applet root',
          'opaque-origin UUID fallback',
          'one-tap single-city creation, double-tap protection, adding a city and reopening the same trip',
          'native image import and camera',
          'foreground location cancellation',
          'two distinct positions',
          'save failure and retry',
          'reopen persistence',
          'daily stop persistence, linked check-ins, route paths and day filtering',
          'endpoint-based route preview, cancel, apply, reopen and restore',
          'native packing checklist and expense ledger persistence',
          'itinerary, journal and map navigation on a compact screen',
          'mocked native tile requests and cache',
          'distinct map position modes and missing coordinates',
          'multi-photo EXIF grouping, title request privacy, editable AI and manual titles',
          'atomic event batch retry, edit and reopen with photos',
          'three example journals, including a city transfer day and its ordered stops',
          'transfer-day sight and hotel browsing, named place selection, manual fallback and restored search',
          'on-demand place preview, day pins, tile failure and retry, both returns to the unsaved stay, and saved day route',
          'overnight dates after reopening, cold offline airport selection and persisted map pins',
          'day-position selection, failed-save retry, matching route and map order, cross-day move with original check-in links',
          'consecutive sights and hotel browsing in the same city search, clean drafts and exactly-once retry',
          'directly adding two nearby sights, duplicate-tap protection, failed write and retry from the result',
          'city-scoped sight and hotel result maps, coincident venues, pin selection and return to reviewed drafts',
          'rescheduling a new hotel, then continuing at the arrival city on the new day',
          'returning to the last saved stop, continuing stay or checkout in the day timeline',
          'comparing a sight to an unnumbered checkout hotel in both maps without occupying another night',
          'scoped sight and lodging types across the list, map, quick add and hotel review',
          'departure-city sights in trip order from review, list and map, explicit overrides and stable overnight stops',
          'an immediate manual save waits for bundled city centers and writes once in transfer order',
          'whole-day reordering from itinerary and map with drag, tap, cancel, persistence and retry',
          'paired hotel dates, preserved nights, saved booking moves, and finding places after a day change',
          'scheduling named hotel results from list and map, and adding named sights with their city and directory identity',
        ],
      },
      null,
      2,
    ),
  );
} catch (error) {
  const applet_text = await page
    ?.frameLocator('#applet')
    .locator('body')
    .innerText({ timeout: 1_000 })
    .catch(() => 'Applet unavailable');
  console.error(JSON.stringify({ applet_text, calls, errors, browser_messages }, null, 2));
  throw error;
} finally {
  await browser?.close();
  await server.stop(true);
}
