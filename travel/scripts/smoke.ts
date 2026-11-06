import { firefox } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import assert from 'node:assert/strict';
import type { Journal } from '../src/lib/types';

const root = resolve('dist');
const output = resolve('artifacts/qa');
await mkdir(output, { recursive: true });
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    const path = resolve(root, `.${url.pathname === '/' ? '/index.html' : url.pathname}`);
    if (!path.startsWith(root + sep)) return new Response('Not found', { status: 404 });
    const file = Bun.file(path);
    return (await file.exists()) ? new Response(file) : new Response('Not found', { status: 404 });
  },
});
const browser = await firefox.launch({ headless: true, executablePath: process.env.FIREFOX_PATH });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    timezoneId: 'Asia/Shanghai',
  });
  await context.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      const state = window as unknown as { fail_next_save?: boolean };
      if (this.name === 'journal' && state.fail_next_save) {
        state.fail_next_save = false;
        throw new DOMException(
          'Test storage is full. Your draft can be retried.',
          'QuotaExceededError',
        );
      }
      return original.apply(this, args);
    };
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition(success: PositionCallback) {
          success({
            coords: { latitude: 10.12345, longitude: 20.54321, accuracy: 12 },
            timestamp: Date.now(),
          } as GeolocationPosition);
        },
      },
    });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const unexpected_requests: string[] = [];
  let tile_requests = 0;
  let failed_tile_requests = 0;
  let successful_tile_requests = 0;
  let fail_tiles = false;
  const tile_png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const drawing = canvas.getContext('2d')!;
    drawing.fillStyle = '#e9eee3';
    drawing.fillRect(0, 0, 256, 256);
    drawing.strokeStyle = '#c9d4c4';
    drawing.lineWidth = 12;
    drawing.beginPath();
    drawing.moveTo(0, 180);
    drawing.lineTo(256, 60);
    drawing.stroke();
    drawing.strokeStyle = '#ffffff';
    drawing.lineWidth = 5;
    drawing.beginPath();
    drawing.moveTo(0, 128);
    drawing.lineTo(256, 128);
    drawing.moveTo(128, 0);
    drawing.lineTo(128, 256);
    drawing.stroke();
    drawing.fillStyle = '#647263';
    drawing.font = '11px sans-serif';
    drawing.fillText('SYNTHETIC TEST MAP', 64, 246);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    if (
      url.hostname === 'tile.openstreetmap.org' ||
      url.hostname.endsWith('.tile.openstreetmap.org')
    ) {
      tile_requests++;
      if (fail_tiles) {
        failed_tile_requests++;
        return route.fulfill({
          status: 503,
          body: 'Simulated tile outage',
          headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
        });
      }
      successful_tile_requests++;
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(tile_png, 'base64'),
        headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=604800' },
      });
    }
    unexpected_requests.push(url.origin);
    await route.abort();
  });
  const readJournal = () =>
    page.evaluate(
      () =>
        new Promise<Journal>((resolve, reject) => {
          const request = indexedDB.open('apell-travel-journal');
          request.onsuccess = () => {
            const database = request.result;
            const transaction = database.transaction('journal');
            const get = transaction.objectStore('journal').get('current');
            get.onsuccess = () => {
              database.close();
              resolve(get.result as Journal);
            };
            get.onerror = () => {
              database.close();
              reject(get.error);
            };
          };
          request.onerror = () => reject(request.error);
        }),
    );
  const readPhotoCount = () =>
    page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const request = indexedDB.open('apell-travel-journal');
          request.onsuccess = () => {
            const database = request.result;
            const count = database.transaction('photos').objectStore('photos').count();
            count.onsuccess = () => {
              database.close();
              resolve(count.result);
            };
            count.onerror = () => reject(count.error);
          };
        }),
    );
  const waitClosed = () => page.locator('dialog').waitFor({ state: 'detached' });
  const closeDetail = async () => {
    await page
      .getByRole('dialog', { name: 'Check-in', exact: true })
      .getByRole('button', { name: 'Close dialog' })
      .click();
    await waitClosed();
  };
  const assertMobileLayout = async () => {
    assert.equal(
      await page.getByRole('navigation', { name: 'Main views' }).getByRole('button').count(),
      2,
    );
    const layout = await page.evaluate(() => {
      const footer = document.querySelector<HTMLElement>('.bottom-bar')!.getBoundingClientRect();
      return {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        body_height: document.body.scrollHeight,
        viewport_width: innerWidth,
        viewport_height: innerHeight,
        footer_bottom: footer.bottom,
        footer_height: footer.height,
      };
    });
    assert(layout.width <= layout.viewport_width, 'Mobile page overflows horizontally.');
    assert(
      layout.height <= layout.viewport_height + 1 &&
        layout.body_height <= layout.viewport_height + 1,
      'Only the content should scroll; the body must remain fixed.',
    );
    assert(
      Math.abs(layout.footer_bottom - layout.viewport_height) <= 2,
      'Main navigation must remain at the viewport bottom.',
    );
    assert(layout.footer_height >= 44, 'Bottom navigation needs a usable touch target.');
  };
  await page.goto(`http://127.0.0.1:${server.port}`);
  await page.getByRole('heading', { name: 'Timeline', exact: true }).waitFor();
  assert.equal(tile_requests, 0, 'Opening Timeline must not fetch map tiles.');
  await page.screenshot({ path: resolve(output, 'desktop-empty.png'), fullPage: true });
  await page.getByRole('button', { name: 'Start a trip', exact: true }).click();
  await page.getByLabel('Trip name').fill('Coastal days');
  await page.getByLabel('Start date').fill('2026-05-01');
  await page.getByLabel('End date').fill('2026-05-04');
  await page
    .getByLabel('A little about the trip')
    .fill('A few quiet days, new streets, and the long way home.');
  await page.locator('dialog').getByRole('button', { name: 'Create trip', exact: true }).click();
  await waitClosed();
  await page.getByRole('button', { name: 'New check-in', exact: true }).click();
  await page.getByLabel('Place name', { exact: true }).fill('Old harbour');
  await page.getByLabel('City or area').fill('Seaside');
  await page.locator('summary').click();
  await page.getByLabel('Place latitude', { exact: true }).fill('10.12');
  await page.getByLabel('Place longitude', { exact: true }).fill('20.54');
  await page.getByRole('button', { name: 'Use current location' }).click();
  await page.getByText('Device location · ±12 m').waitFor();
  await page.getByLabel('Visit date & time').fill('2026-05-01T09:35');
  await page.getByLabel('Visit time zone').selectOption('480');
  await page.getByLabel('Notes').fill('Salt in the air. A good place to slow down.');
  const photo = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 650;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#cbdacb';
    ctx.fillRect(0, 0, 900, 325);
    ctx.fillStyle = '#719c99';
    ctx.fillRect(0, 325, 900, 325);
    ctx.fillStyle = '#e7dbad';
    ctx.beginPath();
    ctx.arc(670, 170, 65, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#334f46';
    ctx.beginPath();
    ctx.moveTo(0, 360);
    ctx.lineTo(340, 240);
    ctx.lineTo(500, 360);
    ctx.fill();
    ctx.fillStyle = '#f4efde';
    ctx.font = 'italic 42px Georgia';
    ctx.fillText('A moment by the water', 180, 510);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('input[type=file][multiple]').setInputFiles({
    name: 'test-harbour.png',
    mimeType: 'image/png',
    buffer: Buffer.from(photo, 'base64'),
  });
  await page.getByRole('button', { name: 'Remove photo 1', exact: true }).waitFor();
  await page.evaluate(() => {
    (window as unknown as { fail_next_save: boolean }).fail_next_save = true;
  });
  await page.getByRole('button', { name: 'Save check-in', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Test storage is full' }).waitFor();
  assert.equal(
    await page.getByLabel('Notes').inputValue(),
    'Salt in the air. A good place to slow down.',
  );
  await page.getByRole('button', { name: 'Save check-in', exact: true }).click();
  await waitClosed();
  let journal = await readJournal();
  const trip_id = journal.trips[0].id;
  const place_id = journal.places[0].id;
  assert.equal(journal.places.length, 1);
  assert.equal(journal.check_ins[0].actual_location?.latitude, 10.12345);
  assert.equal(journal.places[0].position?.latitude, 10.12);
  assert.equal(journal.check_ins[0].visited_at, '2026-05-01T01:35:00.000Z');
  assert.equal(await readPhotoCount(), 1);
  await page.getByRole('button', { name: 'New check-in', exact: true }).click();
  await page.getByLabel('Choose a saved place').selectOption(journal.places[0].id);
  await page.getByLabel('Visit latitude', { exact: true }).fill('10.13');
  await page.getByLabel('Visit longitude', { exact: true }).fill('20.55');
  await page.getByLabel('Visit date & time').fill('2026-05-02T17:20');
  await page.getByLabel('Notes').fill('Back again, this time at sunset.');
  await page.getByRole('button', { name: 'Save check-in', exact: true }).click();
  await waitClosed();
  journal = await readJournal();
  assert.equal(journal.check_ins.length, 2);
  assert.equal(journal.places.length, 1);
  assert.notEqual(
    journal.check_ins[0].actual_location?.latitude,
    journal.check_ins[1].actual_location?.latitude,
  );
  assert(
    (await page.locator('.timeline-list .visit-card').first().innerText()).includes('Back again'),
    'Timeline must show the newest visit first.',
  );
  await page
    .locator('.timeline-list .visit-card')
    .filter({ hasText: 'Salt in the air.' })
    .getByRole('button', { name: 'Open check-in at Old harbour' })
    .click();
  await page.getByRole('button', { name: 'Edit check-in', exact: true }).click();
  await page.getByLabel('Edit this place for all its visits').check();
  await page.getByLabel('Place name', { exact: true }).fill('');
  await page.getByLabel('Edit this place for all its visits').uncheck();
  assert.equal(await page.getByRole('button', { name: 'Save check-in' }).isEnabled(), true);
  await page.getByLabel('Notes').fill('Salt in the air. The best kind of morning.');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByText('Discard your unsaved changes?').waitFor();
  await page.getByRole('button', { name: 'Save check-in' }).click();
  await page.getByRole('dialog', { name: 'Check-in', exact: true }).waitFor();
  await closeDetail();
  assert.equal(await readPhotoCount(), 1);
  await page
    .getByRole('button', { name: 'Open photo: Old harbour, photo 1' })
    .scrollIntoViewIfNeeded();
  await page.locator('.visit-photos img').first().waitFor();
  await page.screenshot({ path: resolve(output, 'desktop-timeline.png'), fullPage: true });
  await page.getByRole('button', { name: 'Open photo: Old harbour, photo 1' }).click();
  await page.locator('.lightbox img').waitFor();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await waitClosed();
  await page.getByRole('button', { name: 'New check-in', exact: true }).click();
  await page.getByLabel('Place name', { exact: true }).fill('Unknown stop');
  await page.getByLabel('Visit date & time').fill('2026-05-03T11:00');
  await page.getByLabel('Notes').fill('A remembered stop without coordinates.');
  await page.getByRole('button', { name: 'Save check-in', exact: true }).click();
  await waitClosed();
  await page.getByRole('button', { name: 'Trips', exact: true }).click();
  await page.getByRole('button', { name: 'New trip', exact: true }).click();
  await page.getByLabel('Trip name').fill('City wander');
  await page.getByRole('button', { name: 'Create trip', exact: true }).click();
  await waitClosed();
  await page.getByLabel('Trip filter').selectOption(trip_id);
  await page.reload();
  await page.locator('.timeline-list .visit-card').nth(2).waitFor();
  assert.equal(await page.locator('.timeline-list .visit-card').count(), 3);
  await page.getByLabel('Trip filter').selectOption(trip_id);
  await page.setViewportSize({ width: 390, height: 844 });
  await assertMobileLayout();
  await page.screenshot({ path: resolve(output, 'mobile-timeline.png'), fullPage: true });
  await page.getByRole('button', { name: 'New check-in', exact: true }).click();
  await page.getByLabel('Choose a saved place').selectOption(place_id);
  await page.getByLabel('Visit latitude', { exact: true }).fill('12');
  await page.screenshot({ path: resolve(output, 'mobile-form.png'), fullPage: true });
  await page.getByRole('button', { name: 'Save check-in' }).click();
  await page.getByRole('alert').filter({ hasText: 'Enter both latitude and longitude' }).waitFor();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await waitClosed();
  await page
    .getByRole('navigation', { name: 'Main views' })
    .getByRole('button', { name: 'Map', exact: true })
    .click();
  await page.locator('.journal-map-pin').nth(1).waitFor();
  await page.locator('.leaflet-tile-loaded').first().waitFor();
  assert(tile_requests > 0, 'Map must load the mocked tile service.');
  const positions = () =>
    page.locator('.journal-map-pin').evaluateAll((elements) =>
      elements
        .map((element) => ({
          latitude: Number(element.getAttribute('data-latitude')),
          longitude: Number(element.getAttribute('data-longitude')),
          visits: Number(element.getAttribute('data-visit-count')),
        }))
        .sort((a, b) => a.latitude - b.latitude),
    );
  assert.deepEqual(await positions(), [
    { latitude: 10.12345, longitude: 20.54321, visits: 1 },
    { latitude: 10.13, longitude: 20.55, visits: 1 },
  ]);
  await page.getByRole('button', { name: '1 without visit coordinates' }).waitFor();
  await assertMobileLayout();
  await page.screenshot({ path: resolve(output, 'mobile-map.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 500 });
  await assertMobileLayout();
  await page.screenshot({ path: resolve(output, 'compact-map.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 568 });
  await assertMobileLayout();
  const attribution_geometry = await page.evaluate(() => {
    const attribution = document
      .querySelector('.leaflet-control-attribution')!
      .getBoundingClientRect();
    const add_button = document.querySelector('.add-check-in')!.getBoundingClientRect();
    return {
      overlap_width:
        Math.min(attribution.right, add_button.right) - Math.max(attribution.left, add_button.left),
      overlap_height:
        Math.min(attribution.bottom, add_button.bottom) - Math.max(attribution.top, add_button.top),
      attribution_left: attribution.left,
      attribution_right: attribution.right,
      viewport_width: innerWidth,
    };
  });
  assert(
    attribution_geometry.overlap_width <= 0 || attribution_geometry.overlap_height <= 0,
    `The add button overlaps map attribution at 320px: ${JSON.stringify(attribution_geometry)}`,
  );
  assert(
    attribution_geometry.attribution_left >= 0 &&
      attribution_geometry.attribution_right <= attribution_geometry.viewport_width,
    'Map attribution must remain fully inside the narrow viewport.',
  );
  await page.screenshot({ path: resolve(output, 'narrow-map.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Named places', exact: true }).click();
  await page.locator('.journal-map-pin[data-visit-count="2"]').waitFor();
  assert.deepEqual(await positions(), [{ latitude: 10.12, longitude: 20.54, visits: 2 }]);
  await page.getByRole('button', { name: '1 without place coordinates' }).click();
  const empty_trip_id = (await readJournal()).trips.find(
    (trip) => trip.title === 'City wander',
  )!.id;
  await page.getByRole('region', { name: 'Check-ins without coordinates' }).waitFor();
  await page.getByLabel('Trip filter').selectOption(empty_trip_id);
  await page.locator('.map-selection-card').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.journal-map-pin').count(), 0);
  assert.equal(
    await page
      .getByRole('button', { name: 'Named places', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  await page.getByLabel('Trip filter').selectOption(trip_id);
  await page.locator('.journal-map-pin[data-visit-count="2"]').waitFor();
  assert.equal(
    await page.locator('.map-selection-card').count(),
    0,
    'Returning to the trip must not reopen a stale missing-coordinate panel.',
  );
  await page.getByRole('button', { name: '1 without place coordinates' }).click();
  await page
    .getByRole('region', { name: 'Check-ins without coordinates' })
    .getByRole('button', { name: 'View check-in' })
    .click();
  const detail = page.getByRole('dialog', { name: 'Check-in', exact: true });
  await detail.getByRole('heading', { name: 'Unknown stop' }).waitFor();
  assert((await detail.innerText()).includes('Location not recorded'));
  assert((await detail.innerText()).includes('No reference coordinates'));
  await closeDetail();
  await page.getByRole('button', { name: 'Close map selection' }).click();
  await page.locator('.journal-map-pin').click();
  await page.getByRole('region', { name: 'Check-ins at selected map pin' }).waitFor();
  await page.getByLabel('Trip filter').selectOption(empty_trip_id);
  await page.locator('.map-selection-card').waitFor({ state: 'detached' });
  await page.getByLabel('Trip filter').selectOption(trip_id);
  await page.locator('.journal-map-pin[data-visit-count="2"]').waitFor();
  assert.equal(
    await page.locator('.map-selection-card').count(),
    0,
    'A selected pin from another trip must not survive filtering.',
  );
  assert.equal(
    await page
      .getByRole('button', { name: 'Named places', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  await page.locator('.journal-map-pin').click();
  await page
    .getByRole('region', { name: 'Check-ins at selected map pin' })
    .getByRole('button', { name: 'View check-in' })
    .first()
    .click();
  await detail.getByRole('heading', { name: 'Old harbour' }).waitFor();
  await closeDetail();
  await page.getByRole('button', { name: 'Close map selection' }).click();
  fail_tiles = true;
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page
    .locator('.map-tile-status')
    .filter({ hasText: 'Map background unavailable' })
    .waitFor();
  assert(
    failed_tile_requests > 0,
    'The outage scenario must request uncached tiles at a new zoom.',
  );
  assert.deepEqual(await positions(), [{ latitude: 10.12, longitude: 20.54, visits: 2 }]);
  await page.locator('.journal-map-pin').click();
  await page
    .getByRole('region', { name: 'Check-ins at selected map pin' })
    .getByRole('button', { name: 'View check-in' })
    .first()
    .click();
  await detail.getByRole('heading', { name: 'Old harbour' }).waitFor();
  await closeDetail();
  await page.getByRole('button', { name: 'Close map selection' }).click();
  const successes_before_retry = successful_tile_requests;
  fail_tiles = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.waitForFunction(() => {
    const tiles = [...document.querySelectorAll<HTMLImageElement>('.map-view .leaflet-tile')];
    return (
      tiles.length > 0 &&
      tiles.every((tile) => tile.complete && tile.naturalWidth > 0 && tile.style.opacity !== '0')
    );
  });
  await page.locator('.map-tile-status').waitFor({ state: 'detached' });
  assert(
    successful_tile_requests > successes_before_retry,
    'Retry must obtain replacement tiles after the outage.',
  );
  assert.equal(await page.getByLabel('Trip filter').inputValue(), trip_id);
  await page
    .getByRole('navigation', { name: 'Main views' })
    .getByRole('button', { name: 'Timeline', exact: true })
    .click();
  assert.equal(await page.getByLabel('Trip filter').inputValue(), trip_id);
  await assertMobileLayout();
  await page.setViewportSize({ width: 390, height: 500 });
  await assertMobileLayout();
  const requests_before_resize = tile_requests;
  await page.setViewportSize({ width: 430, height: 844 });
  await page.waitForTimeout(200);
  assert.equal(tile_requests, requests_before_resize, 'Hidden map must not fetch tiles on resize.');
  await page
    .locator('.timeline-list .visit-card')
    .filter({ hasText: 'The best kind of morning.' })
    .getByRole('button', { name: 'Open check-in at Old harbour' })
    .click();
  await detail.getByRole('button', { name: 'Delete check-in', exact: true }).click();
  await page.getByRole('button', { name: 'Keep it', exact: true }).click();
  assert.equal((await readJournal()).check_ins.length, 3);
  await detail.getByRole('button', { name: 'Delete check-in', exact: true }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await waitClosed();
  await page.waitForFunction(
    () =>
      new Promise<boolean>((resolve) => {
        const request = indexedDB.open('apell-travel-journal');
        request.onsuccess = () => {
          const db = request.result;
          const count = db.transaction('photos').objectStore('photos').count();
          count.onsuccess = () => {
            db.close();
            resolve(count.result === 0);
          };
        };
      }),
  );
  assert.equal((await readJournal()).check_ins.length, 2);
  assert.deepEqual(errors, []);
  assert.deepEqual(
    unexpected_requests,
    [],
    'Smoke tests must never use unmocked external services.',
  );
  console.log(
    'Firefox smoke passed: Timeline + Map, separate locations, missing coordinates, filter reset, offline pins/retry, mocked tiles, photos/save recovery, and fixed mobile navigation down to 320px.',
  );
} finally {
  await browser.close();
  server.stop(true);
}
