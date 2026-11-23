import { strict as assert } from 'node:assert';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firefox, type Browser, type Locator, type Page } from 'playwright-core';
import sharp from 'sharp';
import type { LlmRequest } from '@apell/sdk';
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
    { name: 'test inn', kind: 'hotel', category: 'accommodation' },
  ];
  const features = city
    ? venues.flatMap((venue, index) => {
        const name = `${city.name} ${venue.name}`;
        const include = geoapify
          ? categories.some(
              (value) => venue.category === value || venue.category.startsWith(value + '.'),
            )
          : tags.length === 0 || tags.includes(`tourism:${venue.kind}`);
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
                  osm_key: 'tourism',
                  osm_value: venue.kind,
                },
            geometry: { type: 'Point', coordinates: [city.longitude, city.latitude] },
          },
        ];
      })
    : [];
  return {
    status: query === 'Unavailable inn' || query === 'Nara Park' ? 503 : 200,
    headers: [{ name: 'Content-Type', value: 'application/json' }],
    body: Array.from(
      new TextEncoder().encode(JSON.stringify({ type: 'FeatureCollection', features })),
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
  const sights = dialog.getByRole('button', { name: 'Sights', exact: true });
  const hotels = dialog.getByRole('button', { name: 'Hotels', exact: true });
  const kyoto = dialog.getByRole('button', { name: 'Search in Kyoto', exact: true });
  const nara = dialog.getByRole('button', { name: 'Search in Nara', exact: true });
  const kyoto_museum = dialog.getByRole('button', { name: /^Kyoto test museum/ });
  const nara_museum = dialog.getByRole('button', { name: /^Nara test museum/ });
  const nara_inn = dialog.getByRole('button', { name: /^Nara test inn/ });
  const check_in = dialog.getByLabel('Check-in date', { exact: true });
  const check_out = dialog.getByLabel('Check-out date', { exact: true });
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
  await nara.click();
  await nara_inn.waitFor();
  assert.deepEqual(place_requests.at(-1), { city: 'Kyoto', query: 'Late inn' });
  release_place();
  pending_place = undefined;
  await dialog.getByRole('heading', { name: 'Hotels near Nara' }).waitFor();
  assert.equal(await place_search.inputValue(), 'test inn');
  await nara_inn.click();
  assert.equal(await dialog.getByLabel('Category').inputValue(), 'stay');
  assert.equal(await check_in.inputValue(), day_two);
  assert.equal(await check_out.inputValue(), '2030-05-22');
  await dialog.getByRole('button', { name: 'Change place', exact: true }).click();
  await nara_inn.waitFor();
  assert.equal(await hotels.getAttribute('aria-pressed'), 'true');
  assert.equal(await nara.getAttribute('aria-pressed'), 'true');
  assert.equal(await place_search.inputValue(), 'test inn');
  await page
    .locator('#applet')
    .screenshot({ path: resolve(qa_directory, 'native-transfer-place-search.png') });
  await nara_inn.click();
  await check_out.fill('2030-05-23');
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
    assert.equal(await check_in.inputValue(), day_two);
    assert.equal(await check_out.inputValue(), '2030-05-23');
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
  await save_stop.click();
  await dialog.waitFor({ state: 'hidden' });
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
  assert.equal(await check_in.inputValue(), day_two);
  assert.equal(await check_out.inputValue(), '2030-05-23');
  assert.equal(place_requests.length, requests_before_edit, 'Opening a saved stop stays local.');
  await page.locator('#applet').evaluate((element) => {
    element.style.width = '320px';
  });
  for (const field of [
    check_in,
    check_out,
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
  const continuing_editor = frame.getByRole('dialog', { name: 'Edit stop', exact: true });
  assert.equal(
    await continuing_editor.getByLabel('Check-in date', { exact: true }).inputValue(),
    day_two,
  );
  await continuing_editor.getByRole('button', { name: 'Save changes' }).click();
  await continuing_editor.waitFor({ state: 'hidden' });
  assert.equal(await frame.getByLabel('Choose itinerary date').inputValue(), '2030-05-22');
  await frame.getByRole('button', { name: 'Staying at Nara test inn' }).click();
  assert.equal(await check_in.inputValue(), day_two);
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await frame.getByRole('button', { name: 'Next day', exact: true }).click();
  await frame.getByRole('button', { name: 'Check out of Nara test inn' }).waitFor();
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
  await frame.getByRole('button', { name: 'Check out of Kyoto test inn' }).waitFor();
  await frame.getByRole('button', { name: 'Check out of Kyoto test inn' }).click();
  await dialog.getByRole('button', { name: 'Change place' }).click();
  assert.equal(await kyoto.getAttribute('aria-pressed'), 'true');
  assert.equal(await shellBack(), true);
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  assert.equal(await shellBack(), true, 'Back from the trip itinerary returns to the library.');
  await frame.getByRole('heading', { name: 'Your trips', exact: true }).waitFor();
  assert.equal(await shellBack(), false);
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
