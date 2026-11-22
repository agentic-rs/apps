import { firefox, type Locator } from 'playwright-core';
import sharp from 'sharp';
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
  const waitClosed = () => page.locator('dialog').first().waitFor({ state: 'detached' });
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const first_city = page.getByRole('dialog', { name: 'Choose your first city', exact: true });
  const add_city = page.getByRole('dialog', { name: 'Add a city', exact: true });
  async function chooseCity(picker: Locator, query: string, option: string) {
    await picker.getByRole('searchbox', { name: 'Search cities' }).fill(query);
    await picker.getByRole('button', { name: option, exact: true }).click();
  }
  const goTo = async (view: 'Itinerary' | 'Journal' | 'Map' | 'Toolbox') => {
    await page
      .getByRole('navigation', { name: 'Main views' })
      .getByRole('button', { name: view, exact: true })
      .click();
  };
  const chooseDay = async (date: string) => {
    const picker = page.getByLabel('Choose itinerary date');
    await picker.fill(date);
    assert.equal(await picker.inputValue(), date);
  };
  const openTrip = () => button('Open trip Coastal days').click();
  const addStop = async (name: string, latitude: string, longitude: string) => {
    await button('Add stop').click();
    const editor = page.getByRole('dialog', { name: 'Add stop', exact: true });
    await editor.getByLabel('Stop name').fill(name);
    await editor.getByText('Map coordinates', { exact: false }).click();
    await editor.getByLabel('Stop latitude').fill(latitude);
    await editor.getByLabel('Stop longitude').fill(longitude);
    await editor.getByRole('button', { name: 'Save stop' }).click();
    await waitClosed();
  };
  const assertFullScreenEditor = async (editor: Locator) => {
    await editor.waitFor({ state: 'visible' });
    const geometry = await editor.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        left: bounds.left,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
        width: innerWidth,
        height: innerHeight,
      };
    });
    assert(
      Math.abs(geometry.left) <= 1 && Math.abs(geometry.top) <= 1,
      `Editor must begin at the viewport origin: ${JSON.stringify(geometry)}`,
    );
    assert(
      Math.abs(geometry.right - geometry.width) <= 1 &&
        Math.abs(geometry.bottom - geometry.height) <= 1,
      `Editor must fill the viewport: ${JSON.stringify(geometry)}`,
    );
  };
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
      4,
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
  await page.getByRole('heading', { name: 'Fieldnotes', exact: true }).waitFor();
  assert.equal(tile_requests, 0, 'Opening the trip library must not fetch map tiles.');
  await page.screenshot({ path: resolve(output, 'desktop-empty.png'), fullPage: true });
  await page.getByRole('button', { name: 'New trip', exact: true }).click();
  await first_city.waitFor();
  assert.equal(await page.getByLabel('Trip name').count(), 0);
  await chooseCity(first_city, 'Tokyo', 'Tokyo, Japan');
  assert.equal(await page.getByLabel('Trip name').inputValue(), 'Tokyo trip');
  await page.getByLabel('Trip name').fill('Coastal days');
  await page.getByLabel('Start date').fill('2026-05-01');
  await page.getByLabel('End date').fill('2026-05-04');
  await page
    .getByLabel('Description')
    .fill('A few quiet days, new streets, and the long way home.');
  await button('Add city').click();
  await chooseCity(add_city, 'Kyoto', 'Kyoto, Japan');
  assert.equal(await page.getByLabel('Trip name').inputValue(), 'Coastal days');
  assert.equal(await page.getByLabel('Start date').inputValue(), '2026-05-01');
  await page.locator('dialog').getByRole('button', { name: 'Create trip', exact: true }).click();
  await waitClosed();
  assert.deepEqual((await readJournal()).trips[0].cities, ['Tokyo', 'Kyoto']);
  const second_tab = await context.newPage();
  await second_tab.goto(page.url());
  await second_tab.getByRole('button', { name: 'Open trip Coastal days' }).click();
  await second_tab.getByRole('button', { name: 'Add stop', exact: true }).click();
  await second_tab.getByLabel('Stop name').fill('Draft in another tab');
  await addStop('Lookout', '10.14', '20.56');
  await second_tab.getByRole('button', { name: 'Save stop' }).click();
  await second_tab.getByRole('alert').filter({ hasText: 'changed in another window' }).waitFor();
  assert.equal((await readJournal()).stops.length, 1);
  await second_tab.close();
  await addStop('Old harbour', '10.12', '20.54');
  await button('Move Old harbour earlier').click();
  await page.waitForFunction(
    () => document.querySelector('.itinerary-stop-title')?.textContent === 'Old harbour',
  );
  assert.deepEqual(
    (await readJournal()).stops.map((stop) => stop.title),
    ['Old harbour', 'Lookout'],
  );
  await button('Edit Lookout').click();
  await page.getByLabel('Category').selectOption('food');
  await page.getByLabel('Time').fill('12:45');
  await page.getByLabel('Notes').fill('A picnic above the bay.');
  await button('Save stop').click();
  await waitClosed();
  await button('Check in at Old harbour').click();
  assert.equal(await page.getByLabel('Place name', { exact: true }).inputValue(), 'Old harbour');
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
  assert.equal(await readPhotoCount(), 0);
  assert.equal(
    await page.getByLabel('Notes').inputValue(),
    'Salt in the air. A good place to slow down.',
  );
  await page.getByRole('button', { name: 'Save check-in', exact: true }).click();
  await waitClosed();
  let journal = await readJournal();
  assert.equal(journal.check_ins[0].stop_id, journal.stops[0].id);
  await page
    .getByRole('group', { name: 'Journal at Old harbour' })
    .getByRole('button', { name: 'Open check-in at Old harbour' })
    .waitFor();
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
  assert.equal(await page.getByLabel('Choose itinerary date').inputValue(), '2026-05-02');
  assert.equal(await page.locator('.itinerary-stops li').count(), 0);
  await goTo('Journal');
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
  await chooseCity(first_city, 'Saltwind Bay', 'Use Saltwind Bay');
  assert.equal(await page.getByLabel('Trip name').inputValue(), 'Saltwind Bay trip');
  await page.getByLabel('Trip name').fill('City wander');
  await page.getByRole('button', { name: 'Create trip', exact: true }).click();
  await waitClosed();
  assert.equal(await page.locator('.itinerary-stops li').count(), 0);
  assert.equal(await page.locator('.visit-card').count(), 0);
  await page.reload();
  await button('Open trip City wander').getByText('Saltwind Bay', { exact: true }).waitFor();
  await openTrip();
  await button('Edit trip').click();
  await button('Add city').click();
  await chooseCity(add_city, 'Tokyo', 'Tokyo, Japan');
  await button('Remove city Kyoto').click();
  await button('Add city').click();
  await chooseCity(add_city, 'Kyoto', 'Kyoto, Japan');
  await button('Move Kyoto earlier').click();
  await button('Save trip').click();
  await waitClosed();
  assert.deepEqual(
    (await readJournal()).trips.find((trip) => trip.title === 'Coastal days')?.cities,
    ['Tokyo', 'Kyoto', 'Tokyo'],
  );
  await goTo('Journal');
  await page.locator('.timeline-list .visit-card').nth(2).waitFor();
  assert.equal(await page.locator('.timeline-list .visit-card').count(), 3);
  await button('Trips').click();
  for (const height of [844, 500]) {
    await page.setViewportSize({ width: 390, height });
    await button('New trip').click();
    await assertFullScreenEditor(first_city);
    if (height === 844) {
      await page.screenshot({ path: resolve(output, 'mobile-first-city.png') });
    }
    await chooseCity(first_city, 'Tokyo', 'Tokyo, Japan');
    const editor = page.getByRole('dialog', { name: 'New trip', exact: true });
    await editor.getByRole('button', { name: 'Add city', exact: true }).click();
    await chooseCity(add_city, 'Kyoto', 'Kyoto, Japan');
    await assertFullScreenEditor(editor);
    await page.screenshot({ path: resolve(output, `trip-form-${height}.png`) });
    await editor.getByLabel('Trip name').fill('Unsaved travel idea');
    await page.keyboard.press('Escape');
    await editor.getByText('Discard your unsaved changes?').waitFor();
    await editor.getByRole('button', { name: 'Keep editing', exact: true }).click();
    assert.equal(await editor.getByLabel('Trip name').inputValue(), 'Unsaved travel idea');
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await editor.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await waitClosed();
    assert.equal(
      (await readJournal()).trips.length,
      2,
      'Discarding a full-screen editor must not create a trip.',
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await openTrip();
  await assertMobileLayout();
  await page.waitForFunction(() => {
    const photo = document.querySelector<HTMLImageElement>('.itinerary-linked .visit-photos img');
    return photo && photo.complete && photo.naturalWidth > 0;
  });
  await page.screenshot({ path: resolve(output, 'mobile-itinerary.png'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: resolve(output, 'mobile-itinerary-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByRole('button', { name: 'New check-in', exact: true }).click();
  await assertFullScreenEditor(page.getByRole('dialog', { name: 'New check-in', exact: true }));
  await page.getByLabel('Choose a saved place').selectOption(place_id);
  await page.getByLabel('Visit latitude', { exact: true }).fill('12');
  await page.screenshot({ path: resolve(output, 'mobile-form.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 500 });
  await assertFullScreenEditor(page.getByRole('dialog', { name: 'New check-in', exact: true }));
  await page.screenshot({ path: resolve(output, 'compact-form.png'), fullPage: true });
  await page.getByRole('button', { name: 'Save check-in' }).click();
  await page.getByRole('alert').filter({ hasText: 'Enter both latitude and longitude' }).waitFor();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  assert.equal(await page.getByLabel('Visit latitude', { exact: true }).inputValue(), '12');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await waitClosed();
  await page.setViewportSize({ width: 390, height: 844 });
  await chooseDay('2026-05-01');
  await goTo('Map');
  await page.locator('.map-route-line').waitFor();
  await page.locator('.journal-map-pin[data-stop-numbers="1"][data-latitude="10.12"]').click();
  await page.getByRole('region', { name: 'Stops at selected map pin' }).waitFor();
  await button('Close map selection').click();
  await page.locator('.leaflet-tile-loaded').first().waitFor();
  assert(tile_requests > 0, 'Map must load the mocked tile service.');
  await assertMobileLayout();
  await page.screenshot({ path: resolve(output, 'mobile-map.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 568 });
  await assertMobileLayout();
  await button('Fit all map pins').click();
  const attribution = await page.locator('.leaflet-control-attribution').boundingBox();
  assert(attribution && attribution.x >= 0 && attribution.x + attribution.width <= 321);
  await page.screenshot({ path: resolve(output, 'narrow-map.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await chooseDay('2026-05-02');
  await page.getByText('No stops on this day', { exact: true }).waitFor();
  assert.equal(await page.locator('.map-route-line').count(), 0);
  await button('Actual visits').click();
  await page.locator('.journal-map-pin[data-latitude="10.13"][data-longitude="20.55"]').waitFor();
  assert.equal(await page.locator('.journal-map-pin').count(), 1);
  await chooseDay('2026-05-03');
  await button('1 without visit coordinates').click();
  const missing = page.getByRole('region', { name: 'Entries without coordinates' });
  await missing.getByRole('button', { name: 'View check-in' }).click();
  const detail = page.getByRole('dialog', { name: 'Check-in', exact: true });
  await detail.getByRole('heading', { name: 'Unknown stop' }).waitFor();
  assert((await detail.innerText()).includes('Location not recorded'));
  await closeDetail();
  await chooseDay('2026-05-01');
  await missing.waitFor({ state: 'detached' });
  await button('Named places').click();
  const named_pin = page.locator(
    '.journal-map-pin[data-latitude="10.12"][data-longitude="20.54"][data-visit-count="1"]',
  );
  await named_pin.waitFor();
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
  await named_pin.waitFor();
  await page.locator('.journal-map-pin').click();
  await page
    .getByRole('region', { name: 'Entries at selected map pin' })
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
  await goTo('Itinerary');
  await button('Edit Lookout').click();
  await page.getByLabel('Day', { exact: true }).fill('2026-05-04');
  await button('Save stop').click();
  await waitClosed();
  assert.equal(await page.getByLabel('Choose itinerary date').inputValue(), '2026-05-04');
  await button('Edit Lookout').waitFor();
  assert.equal(await button('Edit Old harbour').count(), 0);
  await chooseDay('2026-05-01');
  await button('Edit Old harbour').click();
  await page.getByLabel('Day', { exact: true }).fill('2026-05-04');
  await button('Save stop').click();
  await waitClosed();
  const linked = page.getByRole('group', { name: 'Journal at Old harbour' });
  await linked.getByText('Recorded 1 May 2026').waitFor();
  await linked.getByRole('button', { name: 'Open check-in at Old harbour' }).click();
  await detail.getByText('The best kind of morning.').waitFor();
  await closeDetail();
  await chooseDay('2026-05-01');
  await page
    .getByRole('region', { name: 'Day journal' })
    .getByRole('button', { name: 'Open check-in at Old harbour' })
    .waitFor();
  await chooseDay('2026-05-04');
  await button('Edit Old harbour').click();
  await button('Delete stop').click();
  await button('Delete').click();
  await waitClosed();
  const unlinked = await readJournal();
  assert.equal(unlinked.stops.length, 1);
  assert.equal(unlinked.check_ins[0].stop_id, undefined);
  assert.equal(await readPhotoCount(), 1);
  await chooseDay('2026-05-01');
  await page
    .getByRole('region', { name: 'Day journal' })
    .getByRole('button', { name: 'Open check-in at Old harbour' })
    .waitFor();
  await goTo('Journal');
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

  const openPhotoEvents = async () => {
    await page.getByRole('button', { name: 'Events from photos', exact: true }).click();
    return page.getByRole('dialog', { name: 'Events from photos', exact: true });
  };
  async function datedPhoto(name: string, camera_time: string, longitude: number) {
    const pixels = sharp(Buffer.from(photo, 'base64')).resize({ width: 240 });
    const buffer = await pixels
      .withExif({
        IFD2: { DateTimeOriginal: camera_time, OffsetTimeOriginal: '+02:00' },
        IFD3: {
          GPSLatitudeRef: 'N',
          GPSLatitude: '12/1 0/1 0/1',
          GPSLongitudeRef: 'E',
          GPSLongitude: `${longitude}/1 0/1 0/1`,
        },
      })
      .jpeg()
      .toBuffer();
    return { name, mimeType: 'image/jpeg', buffer };
  }
  const [early, nearby, later] = await Promise.all([
    datedPhoto('first.jpg', '2026:05:05 08:00:00', 20),
    datedPhoto('second.jpg', '2026:05:05 08:03:00', 20),
    datedPhoto('third.jpg', '2026:05:06 13:00:00', 24),
  ]);
  const undated = {
    name: 'undated.png',
    mimeType: 'image/png',
    buffer: Buffer.from(photo, 'base64'),
  };
  const skipped = {
    name: 'skipped.png',
    mimeType: 'image/png',
    buffer: Buffer.from(tile_png, 'base64'),
  };
  const before_import = await readJournal();
  const initial_photo_count = await readPhotoCount();
  const event_import = await openPhotoEvents();
  await event_import
    .locator('input[type=file][multiple]')
    .setInputFiles([later, nearby, early, undated, skipped]);
  await event_import.getByRole('button', { name: 'Review events', exact: true }).click();
  const reviews = event_import.getByRole('article');
  await reviews.nth(3).waitFor();
  assert.equal(await reviews.count(), 4);
  await page.waitForFunction(() => {
    const photos = document.querySelector('dialog article')?.querySelectorAll('img');
    return (
      photos &&
      photos.length >= 2 &&
      [...photos].every((photo) => photo.complete && photo.naturalWidth > 0)
    );
  });
  await page.screenshot({ path: resolve(output, 'photo-event-review.png') });
  await reviews.last().getByRole('checkbox', { name: 'Include event 4', exact: true }).uncheck();
  const titles_by_time = new Map([
    ['2026-05-05T08:00', 'Morning at the first stop'],
    ['2026-05-06T13:00', 'Afternoon at the second stop'],
    ['', 'An undated memory'],
  ]);
  for (const review of (await reviews.all()).slice(0, 3)) {
    const time_field = review.getByLabel('Event date & time');
    const time = await time_field.inputValue();
    const title = titles_by_time.get(time);
    assert(title, `Unexpected event time ${time}`);
    titles_by_time.delete(time);
    const zone = review.getByLabel('Event time zone');
    const latitude = review.getByLabel('Event latitude');
    const longitude = review.getByLabel('Event longitude');
    if (time) {
      assert.equal(await zone.inputValue(), '120');
      assert.equal(Number(await latitude.inputValue()), 12);
      assert.equal(Number(await longitude.inputValue()), time === '2026-05-05T08:00' ? 20 : 24);
    } else {
      assert.equal(await zone.inputValue(), '');
      assert.equal(await latitude.inputValue(), '');
      assert.equal(await longitude.inputValue(), '');
      await time_field.fill('2026-05-07T12:00');
      await zone.selectOption('0');
    }
    await review.getByLabel('Event title').fill(title);
  }
  assert.equal(titles_by_time.size, 0);
  const save_events = event_import.getByRole('button', { name: 'Save 3 events', exact: true });
  await page.evaluate(() => {
    (window as unknown as { fail_next_save: boolean }).fail_next_save = true;
  });
  await save_events.click();
  await event_import.getByRole('alert').filter({ hasText: 'Test storage is full' }).waitFor();
  assert.deepEqual(await readJournal(), before_import);
  assert.equal(await readPhotoCount(), initial_photo_count);
  await save_events.click();
  await waitClosed();
  const after_import = await readJournal();
  const events = after_import.check_ins.filter((entry) => entry.title);
  assert.equal(events.length, 3);
  const committed_sizes = events.flatMap((event) => event.photos.map((asset) => asset.size_bytes));
  assert.deepEqual(
    committed_sizes.sort((a, b) => a - b),
    [early, nearby, later, undated].map((file) => file.buffer.length).sort((a, b) => a - b),
  );
  assert.equal(await readPhotoCount(), initial_photo_count + 4);
  assert.deepEqual(after_import.places, before_import.places);
  const morning = events.find((event) => event.title === 'Morning at the first stop')!;
  assert.equal(morning.photos.length, 2);
  assert.equal(morning.visited_at, '2026-05-05T06:00:00.000Z');
  assert.equal(morning.place_id, null);
  assert.equal(morning.actual_location?.source, 'photo');
  assert.equal(events.find((event) => event.title === 'An undated memory')?.actual_location, null);
  const discard_import = await openPhotoEvents();
  await discard_import.locator('input[type=file][multiple]').setInputFiles([early, later]);
  await discard_import.getByRole('button', { name: 'Review events', exact: true }).click();
  await discard_import.getByRole('article').nth(1).waitFor();
  assert.equal(await readPhotoCount(), initial_photo_count + 4);
  await discard_import.getByRole('button', { name: 'Cancel', exact: true }).click();
  await discard_import.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await waitClosed();
  assert.equal(await readPhotoCount(), initial_photo_count + 4);
  assert.deepEqual(await readJournal(), after_import);
  await page.reload();
  await openTrip();
  await goTo('Journal');
  await page.getByLabel('Search timeline').fill('Morning at the first stop');
  const morning_card = page.getByRole('button', {
    name: 'Open event Morning at the first stop',
    exact: true,
  });
  await morning_card.click();
  const event_detail = page.getByRole('dialog', { name: 'Event', exact: true });
  await event_detail.getByText('Photo GPS', { exact: true }).waitFor();
  await event_detail.getByRole('button', { name: 'Edit event', exact: true }).click();
  await page.getByLabel('Event title').fill('A new title for the morning');
  await page.getByRole('button', { name: 'Save event', exact: true }).click();
  await event_detail.getByRole('heading', { name: 'A new title for the morning' }).waitFor();
  await event_detail.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByLabel('Search timeline').fill('');
  await page
    .getByRole('button', { name: 'Open event A new title for the morning', exact: true })
    .waitFor();
  const edited = (await readJournal()).check_ins.find((entry) => entry.id === morning.id)!;
  assert.deepEqual({ ...edited, title: morning.title, updated_at: morning.updated_at }, morning);
  await page
    .getByRole('navigation', { name: 'Main views' })
    .getByRole('button', { name: 'Map', exact: true })
    .click();
  await chooseDay('2026-05-05');
  await button('Actual visits').click();
  await page.locator('.journal-map-pin[data-latitude="12"][data-longitude="20"]').click();
  const event_pin = page.getByRole('region', { name: 'Entries at selected map pin' });
  await event_pin.getByRole('heading', { name: 'A new title for the morning', level: 3 }).waitFor();
  await event_pin.getByRole('button', { name: 'View event' }).click();
  await event_detail.getByRole('heading', { name: 'A new title for the morning' }).waitFor();
  await event_detail.getByRole('button', { name: 'Close dialog' }).click();
  await button('Trips').click();
  await button('Open trip City wander').click();
  await chooseDay('2026-05-07');
  await addStop('Trailhead', '30', '100');
  await addStop('Pavilion', '30', '100.04');
  await addStop('Tea garden', '', '');
  await addStop('Inn', '30', '100.06');
  const optimizer = page.getByRole('button', { name: /optimize.*route/i });
  const route_sheet = page.getByRole('dialog', { name: 'Optimize day route' });
  await goTo('Map');
  await optimizer.click();
  await route_sheet.getByRole('listitem').filter({ hasText: 'Tea garden' }).waitFor();
  assert.equal(await route_sheet.getByRole('button', { name: 'Apply order' }).count(), 0);
  await route_sheet.getByRole('button', { name: 'Close', exact: true }).click();
  await goTo('Itinerary');
  await button('Edit Tea garden').click();
  await page.getByText('Map coordinates', { exact: false }).click();
  await page.getByLabel('Stop latitude').fill('30');
  await page.getByLabel('Stop longitude').fill('100.02');
  await page.getByLabel('Time', { exact: false }).fill('12:30');
  await button('Save stop').click();
  await waitClosed();
  const original_route = await readJournal();
  const city_id = original_route.trips.find((trip) => trip.title === 'City wander')!.id;
  const city_stops = original_route.stops.filter((stop) => stop.trip_id === city_id);
  await goTo('Map');
  await optimizer.click();
  const order = route_sheet.getByRole('list', { name: 'Suggested order' }).getByRole('listitem');
  assert.match(await order.nth(1).innerText(), /Tea garden/);
  await route_sheet.getByRole('combobox', { name: 'Start stop' }).selectOption(city_stops[3].id);
  assert.equal(
    await route_sheet.getByRole('combobox', { name: 'Finish stop' }).inputValue(),
    city_stops[0].id,
  );
  assert.match(await order.first().innerText(), /Inn/);
  await route_sheet.getByRole('button', { name: 'Cancel' }).click();
  assert.deepEqual(await readJournal(), original_route);
  await optimizer.click();
  await route_sheet.getByText('12:30').waitFor();
  const sheet_bounds = await route_sheet.boundingBox();
  assert(
    sheet_bounds &&
      Math.abs(sheet_bounds.x) < 1 &&
      Math.abs(sheet_bounds.width - page.viewportSize()!.width) < 1,
    'The route sheet should fill the phone width.',
  );
  await page.screenshot({ path: resolve(output, 'mobile-route-preview.png') });
  await page.evaluate(() => {
    (window as unknown as { fail_next_save: boolean }).fail_next_save = true;
  });
  await route_sheet.getByRole('button', { name: 'Apply order' }).click();
  await route_sheet.getByRole('alert').filter({ hasText: 'Test storage is full' }).waitFor();
  assert.deepEqual(await readJournal(), original_route);
  await route_sheet.getByRole('button', { name: 'Apply order' }).click();
  await waitClosed();
  const reordered = (await readJournal()).stops.filter((stop) => stop.trip_id === city_id);
  assert.deepEqual(reordered, [city_stops[0], city_stops[2], city_stops[1], city_stops[3]]);
  await page.locator('.journal-map-pin[data-stop-numbers="2"][data-longitude="100.02"]').waitFor();

  await goTo('Toolbox');
  await button('Open packing list').click();
  const packing = page.getByRole('region', { name: 'Packing list' });
  const item_name = packing.getByRole('textbox', { name: 'Item name' });
  await item_name.fill('Rain cover');
  await button('Add item').click();
  await packing.getByRole('checkbox', { name: 'Rain cover' }).click();
  await packing.getByRole('status').filter({ hasText: '1 of 6 packed' }).waitFor();
  assert.equal(await packing.getByRole('checkbox', { name: 'Rain cover' }).isChecked(), true);
  await button('Edit items').click();
  await button('Rename Rain cover').click();
  await item_name.fill('Pack cover');
  await button('Save item').click();
  await button('Done').click();
  assert.equal(await packing.getByRole('checkbox', { name: 'Pack cover' }).isChecked(), true);
  await page.screenshot({ path: resolve(output, 'mobile-packing.png') });
  await button('Edit items').click();
  // An explicitly emptied checklist must survive reopening without restoring starter items.
  const remove_items = packing.getByRole('button', { name: /^Remove / });
  while (await remove_items.count()) {
    const first_item = (await remove_items.first().getAttribute('aria-label'))!;
    await packing.getByRole('button', { name: first_item, exact: true }).click();
    await packing
      .getByRole('button', { name: first_item, exact: true })
      .waitFor({ state: 'detached' });
  }
  await packing.getByRole('status').filter({ hasText: '0 of 0 packed' }).waitFor();
  await page.getByRole('main').getByRole('button', { name: 'Toolbox', exact: true }).click();
  await button('Open expenses').click();
  const expenses = page.getByRole('region', { name: 'Trip expenses' });
  const totals = expenses.locator('.expense-totals');
  async function addExpense(title: string, currency: string, amount: string) {
    await expenses.getByRole('button', { name: 'Add expense' }).click();
    const form = page.getByRole('dialog', { name: 'Add expense' });
    await form.getByLabel('Expense name').fill(title);
    await form.getByLabel('Amount').fill(amount);
    await form.getByLabel('Currency').selectOption(currency);
    await form.getByRole('button', { name: 'Save expense' }).click();
    await waitClosed();
  }
  await addExpense('Lunch', 'CNY', '18.45');
  await addExpense('Ferry', 'CNY', '1.55');
  await addExpense('Museum', 'JPY', '300');
  await totals.getByText('CNY 20.00', { exact: true }).waitFor();
  await totals.getByText('JPY 300', { exact: true }).waitFor();
  await button('Edit expense Lunch').click();
  const edit_expense = page.getByRole('dialog', { name: 'Edit expense' });
  await edit_expense.getByLabel('Amount').fill('20.45');
  await edit_expense.getByRole('button', { name: 'Save expense' }).click();
  await waitClosed();
  await totals.getByText('CNY 22.00', { exact: true }).waitFor();
  await button('Edit expense Ferry').click();
  await edit_expense.getByRole('button', { name: 'Delete expense' }).click();
  await edit_expense.getByRole('button', { name: 'Delete', exact: true }).click();
  await waitClosed();
  await totals.getByText('CNY 20.45', { exact: true }).waitFor();
  await totals.getByText('JPY 300', { exact: true }).waitFor();
  await page.screenshot({ path: resolve(output, 'mobile-expenses.png') });
  await page.reload();
  await button('Open trip City wander').click();
  await goTo('Toolbox');
  await button('Open packing list').click();
  await packing.getByRole('status').filter({ hasText: '0 of 0 packed' }).waitFor();
  await button('Trips').click();
  await openTrip();
  await goTo('Toolbox');
  await button('Open packing list').click();
  await packing.getByRole('status').filter({ hasText: '0 of 5 packed' }).waitFor();
  await page.getByRole('main').getByRole('button', { name: 'Toolbox', exact: true }).click();
  await button('Open expenses').click();
  assert.equal(await expenses.locator('.expense-totals').count(), 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(
    unexpected_requests,
    [],
    'Smoke tests must never use unmocked external services.',
  );
  console.log(
    'Firefox smoke passed: city-first and multi-city trips, route previews and retries, packing lists, multi-currency expenses, linked check-ins, photo events, offline maps and mobile layouts.',
  );
} finally {
  await browser.close();
  server.stop(true);
}
