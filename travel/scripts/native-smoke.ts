import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firefox, type Browser, type Locator, type Page } from 'playwright-core';
import type { Journal } from '../src/lib/types';

// No device APIs or existing journal data are accessed. The real production
// SDK speaks to an in-memory host over its ordinary MessageChannel bridge.
const firefox_path = process.env.FIREFOX_PATH;
if (!firefox_path)
  throw new Error('Set FIREFOX_PATH to a Playwright-compatible Firefox executable.');
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
  request_id: string;
  method: string;
  params: Record<string, unknown>;
}

const files = new Map<string, number[]>();
const directories = new Set<string>();
const calls: string[] = [];
const http_urls: string[] = [];
let photo_bytes: number[] = [];
let cancel_photo = true;
let cancel_location = true;
let fail_next_write = false;
let image_sequence = 0;

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
      const image_path = `images/native-photo-${++image_sequence}.png`;
      files.set(image_path, [...photo_bytes]);
      return { path: image_path, mime_type: 'image/png', size_bytes: photo_bytes.length };
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
      assert.equal(
        url.origin,
        'https://tile.openstreetmap.org',
        'Only the mocked tile service may be requested.',
      );
      assert(/^\/\d+\/\d+\/\d+\.png$/.test(url.pathname));
      http_urls.push(url.href);
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
  await page.exposeFunction('__travel_host_call', hostCall);
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
    };
    window.addEventListener('message', (event: MessageEvent) => {
      const frame = document.querySelector<HTMLIFrameElement>('#applet')!;
      if (event.source !== frame.contentWindow || event.data?.type !== 'apell:ready') return;
      const channel = new MessageChannel();
      channel.port1.onmessage = async (message: MessageEvent<BridgeRequest>) => {
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
  await frame.getByRole('heading', { name: 'Timeline', exact: true }).waitFor();
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
  assert.equal(
    await frame.getByRole('navigation', { name: 'Main views' }).getByRole('button').count(),
    2,
  );
  assert.equal(http_urls.length, 0, 'Timeline must not request map tiles.');
  await frame.getByRole('button', { name: 'Start a trip', exact: true }).click();
  await frame.getByLabel('Trip name').fill('Native bridge journey');
  await frame.getByRole('button', { name: 'Create trip', exact: true }).click();
  await frame.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(journal().trips.length, 1);

  await frame.getByRole('button', { name: 'New check-in', exact: true }).click();
  const dialog = frame.getByRole('dialog');
  await dialog.getByLabel('Place name', { exact: true }).fill('Lakeside park');
  await dialog.getByLabel('City or area').fill('North district');
  await dialog.locator('summary').click();
  await dialog.getByLabel('Place latitude', { exact: true }).fill('12');
  await dialog.getByLabel('Place longitude', { exact: true }).fill('34');
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
  await dialog.getByLabel('Visit date & time').fill('2026-05-13T18:30');
  await dialog.getByLabel('Notes').fill('A return visit without recorded coordinates.');
  await dialog.getByRole('button', { name: 'Save check-in', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  saved = journal();
  assert.equal(saved.check_ins.length, 2);
  assert.equal(saved.check_ins[1].actual_location, null);

  await native_frame.goto(`http://127.0.0.1:${server.port}/index.html`);
  await frame.getByRole('heading', { name: 'Timeline', exact: true }).waitFor();
  await frame.locator('.timeline-list .visit-card').nth(1).waitFor();
  await frame
    .getByRole('button', { name: 'Open photo: Lakeside park, photo 1', exact: true })
    .scrollIntoViewIfNeeded();
  await imageReady(frame.getByRole('img', { name: 'Lakeside park, photo 1', exact: true }));
  assert.deepEqual(journal(), saved, 'Reopening should preserve the saved journal and images.');
  await frame.getByLabel('Trip filter').selectOption(saved.trips[0].id);
  const assertNativeLayout = async () => {
    const geometry = await native_frame.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      body_height: document.body.scrollHeight,
      viewport_width: innerWidth,
      viewport_height: innerHeight,
      bottom: document.querySelector('.bottom-bar')!.getBoundingClientRect().bottom,
    }));
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
  };
  await assertNativeLayout();
  await frame
    .getByRole('navigation', { name: 'Main views' })
    .getByRole('button', { name: 'Map', exact: true })
    .click();
  await frame.locator('.journal-map-pin').waitFor();
  await frame.locator('.leaflet-tile-loaded').first().waitFor();
  assert.equal(await frame.locator('.journal-map-pin').getAttribute('data-latitude'), '12.34567');
  assert.equal(await frame.locator('.journal-map-pin').getAttribute('data-longitude'), '34.56789');
  await frame.getByRole('button', { name: '1 without visit coordinates' }).click();
  await frame
    .getByRole('region', { name: 'Check-ins without coordinates' })
    .getByRole('button', { name: 'View check-in' })
    .click();
  await dialog.getByRole('heading', { name: 'Lakeside park', exact: true }).waitFor();
  assert((await dialog.innerText()).includes('Location not recorded'));
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await frame.getByRole('button', { name: 'Close map selection' }).click();
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
    .getByRole('region', { name: 'Check-ins at selected map pin' })
    .getByRole('button', { name: 'View check-in' })
    .first()
    .click();
  await dialog.getByRole('heading', { name: 'Lakeside park', exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await page.evaluate(() => {
    document.querySelector<HTMLIFrameElement>('#applet')!.style.height = '500px';
  });
  await assertNativeLayout();
  await frame
    .getByRole('navigation', { name: 'Main views' })
    .getByRole('button', { name: 'Timeline', exact: true })
    .click();
  assert.equal(await frame.getByLabel('Trip filter').inputValue(), saved.trips[0].id);
  await assertNativeLayout();
  assert(http_urls.length > 0, 'Native map must use the mocked HTTP bridge.');
  assert(
    [...files.keys()].some((path) => path.startsWith('map-tiles/') && path.endsWith('.png')),
    'Native map should persist disposable tile-cache images.',
  );
  assert.deepEqual(journal(), saved, 'Map viewing must not change stored visit locations.');
  assert.deepEqual(errors, [], 'The native applet should not produce uncaught browser errors.');
  for (const method of [
    'photos.pick',
    'camera.capture',
    'location.current',
    'fs.write',
    'fs.read',
    'fs.stat',
    'http.request',
  ]) {
    assert(calls.includes(method), `The applet should exercise ${method}.`);
  }
  console.log(
    JSON.stringify(
      {
        opaque_origin: 'null',
        check_ins: saved.check_ins.length,
        photos: saved.check_ins[0].photos.length,
        verified: [
          'production CSP and SDK handshake',
          'opaque-origin UUID fallback',
          'native image import and camera',
          'foreground location cancellation',
          'two distinct positions',
          'save failure and retry',
          'reopen persistence',
          'Timeline and Map with fixed compact navigation',
          'mocked native tile requests and cache',
          'distinct map position modes and missing coordinates',
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
