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
  await page.goto(`http://127.0.0.1:${server.port}`);
  await page.getByRole('button', { name: 'New trip', exact: true }).waitFor();
  await page.screenshot({ path: resolve(output, 'desktop-empty.png'), fullPage: true });
  await page.getByRole('button', { name: 'New trip', exact: true }).click();
  await page.getByLabel('Trip name').fill('Coastal days');
  await page.getByLabel('Start date').fill('2026-05-01');
  await page.getByLabel('End date').fill('2026-05-04');
  await page
    .getByLabel('A little about the trip')
    .fill('A few quiet days, new streets, and the long way home.');
  await page.locator('dialog').getByRole('button', { name: 'Create trip', exact: true }).click();
  await waitClosed();
  await page.getByRole('button', { name: 'Check in 打卡' }).click();
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
  assert.equal(journal.places.length, 1);
  assert.equal(journal.check_ins[0].actual_location?.latitude, 10.12345);
  assert.equal(journal.places[0].position?.latitude, 10.12);
  assert.equal(journal.check_ins[0].visited_at, '2026-05-01T01:35:00.000Z');
  assert.equal(await readPhotoCount(), 1);
  await page.getByRole('button', { name: 'Check in 打卡' }).click();
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
  await page.getByRole('button', { name: 'Edit check-in at Old harbour' }).first().click();
  await page.getByLabel('Edit this place for all its visits').check();
  await page.getByLabel('Place name', { exact: true }).fill('');
  await page.getByLabel('Edit this place for all its visits').uncheck();
  assert.equal(await page.getByRole('button', { name: 'Save check-in' }).isEnabled(), true);
  await page.getByLabel('Notes').fill('Salt in the air. The best kind of morning.');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByText('Discard your unsaved changes?').waitFor();
  await page.getByRole('button', { name: 'Save check-in' }).click();
  await waitClosed();
  assert.equal(await readPhotoCount(), 1);
  await page.locator('.visit-photos img').first().waitFor();
  await page.screenshot({ path: resolve(output, 'desktop-trip.png'), fullPage: true });
  await page.getByRole('button', { name: 'Open photo: Old harbour, photo 1' }).click();
  await page.locator('.lightbox img').waitFor();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.reload();
  await page
    .getByRole('button', { name: /Coastal days/ })
    .first()
    .click();
  assert.equal(await page.locator('.visit-card').count(), 2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(output, 'mobile-trip.png'), fullPage: true });
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'Mobile page overflows horizontally.',
  );
  await page.getByRole('button', { name: 'Check in 打卡' }).click();
  await page.getByLabel('Choose a saved place').selectOption(journal.places[0].id);
  await page.getByLabel('Visit latitude', { exact: true }).fill('12');
  await page.screenshot({ path: resolve(output, 'mobile-form.png'), fullPage: true });
  await page.getByRole('button', { name: 'Save check-in' }).click();
  await page.getByRole('alert').filter({ hasText: 'Enter both latitude and longitude' }).waitFor();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await waitClosed();
  await page.getByRole('button', { name: /^Photos/ }).click();
  await page.locator('.photo-gallery img').waitFor();
  await page.screenshot({ path: resolve(output, 'mobile-photos.png'), fullPage: true });
  await page.getByRole('button', { name: /^Places/ }).click();
  await page.getByRole('button', { name: /Old harbour Seaside/ }).click();
  assert.equal(await page.locator('.visit-card').count(), 2);
  await page.getByRole('button', { name: 'Delete check-in at Old harbour' }).first().click();
  await page.getByRole('button', { name: 'Keep it', exact: true }).click();
  assert.equal((await readJournal()).check_ins.length, 2);
  await page.getByRole('button', { name: 'Delete check-in at Old harbour' }).first().click();
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
  assert.equal((await readJournal()).check_ins.length, 1);
  assert.deepEqual(errors, []);
  console.log(
    'Firefox smoke passed: trips, two locations, repeated visits, photos, failed-save retry, editing, reopen, delete, desktop/mobile layouts.',
  );
} finally {
  await browser.close();
  server.stop(true);
}
