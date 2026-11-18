import { describe, expect, spyOn, test } from 'bun:test';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createBrowserStorage } from '../src/lib/browser-storage';
import { emptyJournal } from '../src/lib/model';
import { createBrowserPlatform } from '../src/lib/platform';
import type { Journal, PhotoAsset } from '../src/lib/types';

const photo: PhotoAsset = {
  id: 'photo-a',
  path: 'images/photo-a.png',
  mime_type: 'image/png',
  size_bytes: 4,
};
const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: photo.mime_type });
const timestamp = '2026-06-01T08:00:00.000Z';

function journalWithTrip(title = 'Coastal journey'): Journal {
  return {
    ...emptyJournal(),
    trips: [
      {
        id: 'trip-a',
        title,
        description: '',
        start_date: '',
        end_date: '',
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
  };
}

async function writeRawJournal(factory: IDBFactory, name: string, value: unknown) {
  await new Promise<void>((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('journal', 'readwrite');
      transaction.objectStore('journal').put(value, 'current');
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error);
      };
    };
  });
}

describe('browser journal storage', () => {
  test('persists a journal and photo bytes across store instances', async () => {
    const factory = new IDBFactory();
    const first = createBrowserStorage(factory, 'persistent');
    expect(await first.load()).toEqual(emptyJournal());
    await first.savePhoto(photo, blob);
    await first.save(journalWithTrip());
    const reopened = createBrowserStorage(factory, 'persistent');
    expect(await reopened.load()).toEqual(journalWithTrip());
    expect(await (await reopened.readPhoto(photo)).arrayBuffer()).toEqual(await blob.arrayBuffer());
  });

  test('rejects stale writes from another window without losing the newer journal', async () => {
    const factory = new IDBFactory();
    const first = createBrowserStorage(factory, 'multiple');
    const second = createBrowserStorage(factory, 'multiple');
    await first.load();
    await second.load();
    await first.save(journalWithTrip('Saved in first window'));
    await expect(second.save(journalWithTrip('Stale second window'))).rejects.toThrow(
      'another window',
    );
    expect((await second.load()).trips[0]?.title).toBe('Saved in first window');
    await second.save(journalWithTrip('After reload'));
    expect((await first.load()).trips[0]?.title).toBe('After reload');
  });

  test('does not turn corrupt metadata into a new empty journal', async () => {
    const factory = new IDBFactory();
    const storage = createBrowserStorage(factory, 'corrupt');
    await storage.load();
    await writeRawJournal(factory, 'corrupt', { schema_version: 99, unexpected: true });
    await expect(storage.load()).rejects.toThrow('version');
    await expect(storage.save(emptyJournal())).rejects.toThrow('before saving');
    const reopened = createBrowserStorage(factory, 'corrupt');
    await expect(reopened.load()).rejects.toThrow('version');
  });

  test('refuses saving before the existing data has been loaded', async () => {
    const storage = createBrowserStorage(new IDBFactory(), 'unloaded');
    await expect(storage.save(emptyJournal())).rejects.toThrow('before saving');
  });

  test('rejected metadata leaves the previous snapshot and photos intact', async () => {
    const storage = createBrowserStorage(new IDBFactory(), 'invalid');
    await storage.load();
    await storage.save(journalWithTrip());
    await storage.savePhoto(photo, blob);
    const invalid = journalWithTrip();
    invalid.trips[0]!.title = '';
    expect(() => storage.save(invalid)).toThrow();
    expect(await storage.load()).toEqual(journalWithTrip());
    expect((await storage.readPhoto(photo)).size).toBe(4);
  });

  test('never replaces a photo on identity collision, and discarded photos can be removed', async () => {
    const storage = createBrowserStorage(new IDBFactory(), 'photos');
    await storage.savePhoto(photo, blob);
    await expect(
      storage.savePhoto(photo, new Blob(['xxxx'], { type: photo.mime_type })),
    ).rejects.toThrow();
    expect(await (await storage.readPhoto(photo)).arrayBuffer()).toEqual(await blob.arrayBuffer());
    await storage.removePhoto(photo);
    await expect(storage.readPhoto(photo)).rejects.toThrow('missing');
  });

  test('commits only referenced draft photos with the journal and retries an aborted batch', async () => {
    const factory = new IDBFactory();
    const storage = createBrowserStorage(factory, 'staging');
    const reopened = createBrowserStorage(factory, 'staging');
    const extra = { ...photo, id: 'extra', path: 'images/extra.png' };
    await storage.load();
    storage.stagePhoto(photo, blob);
    storage.stagePhoto(extra, blob);
    expect(await storage.readPhoto(photo)).toBe(blob);
    await expect(reopened.readPhoto(photo)).rejects.toThrow('missing');
    const journal = journalWithTrip();
    journal.check_ins.push({
      id: 'event',
      title: 'Morning',
      trip_id: journal.trips[0].id,
      place_id: null,
      visited_at: timestamp,
      utc_offset_minutes: 0,
      actual_location: null,
      notes: '',
      photos: [photo],
      created_at: timestamp,
      updated_at: timestamp,
    });
    // Fail the snapshot update after the transaction has added its photo.
    const put = spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('Test storage is full.', 'QuotaExceededError');
    });
    try {
      await expect(storage.save(journal)).rejects.toThrow('storage is full');
    } finally {
      put.mockRestore();
    }
    expect(await reopened.load()).toEqual(emptyJournal());
    await expect(reopened.readPhoto(photo)).rejects.toThrow('missing');
    expect(await storage.readPhoto(photo)).toBe(blob);
    await Promise.all([storage.save(journal), storage.save(journal)]);
    expect(await reopened.load()).toEqual(journal);
    expect(await (await reopened.readPhoto(photo)).text()).toBe(await blob.text());
    await expect(reopened.readPhoto(extra)).rejects.toThrow('missing');
    await storage.removePhoto(extra);
    await expect(storage.readPhoto(extra)).rejects.toThrow('missing');
    await reopened.removePhoto(photo);
    await expect(storage.readPhoto(photo)).rejects.toThrow('missing');
  });

  test('rejects mismatched photo bytes and unsafe paths', async () => {
    const storage = createBrowserStorage(new IDBFactory(), 'bad-photos');
    await expect(
      storage.savePhoto(photo, new Blob(['x'], { type: photo.mime_type })),
    ).rejects.toThrow('metadata');
    await expect(storage.savePhoto({ ...photo, path: '../journal.json' }, blob)).rejects.toThrow(
      'path',
    );
    await expect(storage.removePhoto({ ...photo, path: 'journal/journal.json' })).rejects.toThrow(
      'path',
    );
  });

  test('browser imports preserve image bytes and infer a missing MIME type from the extension', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: new IDBFactory() });
    try {
      const platform = createBrowserPlatform();
      const imported = await platform.importPhoto(new File(['photo-data'], 'landscape.JPEG'));
      expect(imported?.mime_type).toBe('image/jpeg');
      expect(imported?.path).toMatch(/^images\/.+\.jpg$/);
      expect(await (await platform.readPhoto(imported!)).text()).toBe('photo-data');
      await expect(createBrowserPlatform().readPhoto(imported!)).rejects.toThrow('missing');
      await expect(
        platform.importPhoto(new File(['<svg/>'], 'image.svg', { type: 'image/svg+xml' })),
      ).rejects.toThrow('Choose a');
      await expect(
        platform.importPhoto(new File([], 'empty.png', { type: 'image/png' })),
      ).rejects.toThrow('nonempty');
    } finally {
      if (original) Object.defineProperty(globalThis, 'indexedDB', original);
      else Reflect.deleteProperty(globalThis, 'indexedDB');
    }
  });

  test('browser requests a fresh foreground location and reports a permission denial without fabricating coordinates', async () => {
    const original_database = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    const original_navigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: new IDBFactory() });
    let deny = false;
    let requested_options: PositionOptions | undefined;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        geolocation: {
          getCurrentPosition(
            success: PositionCallback,
            failure: PositionErrorCallback,
            options?: PositionOptions,
          ) {
            requested_options = options;
            if (deny) failure({ code: 1 } as GeolocationPositionError);
            else
              success({
                coords: { latitude: 0, longitude: 0, accuracy: 12 },
                timestamp: Date.parse(timestamp),
              } as GeolocationPosition);
          },
        },
      },
    });
    try {
      const platform = createBrowserPlatform();
      expect(await platform.currentLocation()).toEqual({
        latitude: 0,
        longitude: 0,
        accuracy_m: 12,
        source: 'device',
        captured_at: timestamp,
      });
      expect(requested_options).toEqual({
        enableHighAccuracy: true,
        timeout: 20_000,
        maximumAge: 0,
      });
      deny = true;
      await expect(platform.currentLocation()).rejects.toThrow('permission was declined');
    } finally {
      if (original_database) Object.defineProperty(globalThis, 'indexedDB', original_database);
      else Reflect.deleteProperty(globalThis, 'indexedDB');
      if (original_navigator) Object.defineProperty(globalThis, 'navigator', original_navigator);
      else Reflect.deleteProperty(globalThis, 'navigator');
    }
  });
});
