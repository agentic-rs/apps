import { emptyJournal, parseJournal, parsePhotoAsset } from './model';
import type { Journal, PhotoAsset } from './types';

type StoreName = 'journal' | 'photos';
type Stores = Record<StoreName, IDBObjectStore>;
const snapshot_key = 'current';

function validateBlob(photo: PhotoAsset, blob: Blob): void {
  if (!blob.size || blob.size !== photo.size_bytes || blob.type !== photo.mime_type) {
    throw new Error('The selected photo does not match its metadata.');
  }
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not access browser storage.'));
  });
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => {
      for (const store of ['journal', 'photos']) {
        if (!request.result.objectStoreNames.contains(store))
          request.result.createObjectStore(store);
      }
    };
    request.onerror = () =>
      reject(new Error('Browser storage is unavailable. Check storage permissions.'));
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Close other travel journal windows, then try again.'));
    };
    request.onsuccess = () => {
      const database = request.result;
      if (blocked) return database.close();
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}

/** Photo bytes stay separate from the small, atomic journal snapshot. */
export function createBrowserStorage(
  factory: IDBFactory = indexedDB,
  name = 'apell-travel-journal',
) {
  // Draft files remain File-backed Blob handles owned by this platform instance.
  const draft_photos = new Map<string, Blob>();
  let loaded = false;
  let last_snapshot: string | undefined;
  let pending: Promise<unknown> = Promise.resolve();

  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = pending.then(operation);
    pending = next.catch(() => undefined);
    return next;
  }

  async function transaction<T>(
    names: StoreName[],
    mode: IDBTransactionMode,
    action: (stores: Stores) => Promise<T>,
  ): Promise<T> {
    const database = await openDatabase(factory, name);
    return new Promise<T>((resolve, reject) => {
      let transaction: IDBTransaction;
      try {
        transaction = database.transaction(names, mode);
      } catch (error) {
        database.close();
        reject(error);
        return;
      }
      const stores = Object.fromEntries(
        names.map((key) => [key, transaction.objectStore(key)]),
      ) as Stores;
      let result: T;
      let failure: unknown;
      transaction.oncomplete = () => {
        database.close();
        resolve(result);
      };
      transaction.onabort = () => {
        database.close();
        reject(
          failure ??
            transaction.error ??
            new Error('Could not save journal data. Check available storage.'),
        );
      };
      action(stores).then(
        (value) => {
          result = value;
        },
        (error) => {
          failure = error;
          try {
            transaction.abort();
          } catch {
            database.close();
            reject(error);
          }
        },
      );
    });
  }

  return {
    load: () =>
      serial(async () => {
        loaded = false;
        const value = await transaction(['journal'], 'readonly', (stores) =>
          requestValue<unknown>(stores.journal.get(snapshot_key)),
        );
        const journal = value === undefined ? emptyJournal() : parseJournal(value);
        last_snapshot = value === undefined ? undefined : JSON.stringify(value);
        loaded = true;
        return journal;
      }),
    save: (value: Journal) => {
      const journal = parseJournal(value);
      return serial(async () => {
        if (!loaded) throw new Error('Open the saved journal successfully before saving changes.');
        const retained = new Map<string, Blob>();
        for (const entry of journal.check_ins) {
          for (const photo of entry.photos) {
            const blob = draft_photos.get(photo.path);
            if (blob) {
              validateBlob(photo, blob);
              retained.set(photo.path, blob);
            }
          }
        }
        await transaction(
          retained.size ? ['journal', 'photos'] : ['journal'],
          'readwrite',
          async (stores) => {
            const current = await requestValue<unknown>(stores.journal.get(snapshot_key));
            if (JSON.stringify(current) !== last_snapshot) {
              throw new Error(
                'This journal changed in another window. Reload before saving to preserve those changes.',
              );
            }
            for (const [path, blob] of retained) {
              await requestValue(stores.photos.add(blob, path));
            }
            await requestValue(stores.journal.put(journal, snapshot_key));
          },
        );
        last_snapshot = JSON.stringify(journal);
        for (const path of retained.keys()) draft_photos.delete(path);
      });
    },
    stagePhoto: (value: PhotoAsset, blob: Blob) => {
      const photo = parsePhotoAsset(value);
      validateBlob(photo, blob);
      if (draft_photos.has(photo.path)) throw new Error('This draft photo is already staged.');
      draft_photos.set(photo.path, blob);
    },
    savePhoto: async (value: PhotoAsset, blob: Blob) => {
      const photo = parsePhotoAsset(value);
      validateBlob(photo, blob);
      await transaction(['photos'], 'readwrite', async (stores) => {
        // add() prevents an accidental identity collision from replacing an existing photo.
        await requestValue(stores.photos.add(blob, photo.path));
      });
    },
    readPhoto: async (asset: PhotoAsset): Promise<Blob> => {
      const photo = parsePhotoAsset(asset);
      const value =
        draft_photos.get(photo.path) ??
        (await transaction(['photos'], 'readonly', (stores) =>
          requestValue<unknown>(stores.photos.get(photo.path)),
        ));
      if (
        !(value instanceof Blob) ||
        value.size !== photo.size_bytes ||
        value.type !== photo.mime_type
      ) {
        throw new Error('This photo is missing or damaged in browser storage.');
      }
      return value;
    },
    removePhoto: async (asset: PhotoAsset) => {
      const photo = parsePhotoAsset(asset);
      await serial(async () => {
        if (draft_photos.delete(photo.path)) return;
        await transaction(['photos'], 'readwrite', async (stores) => {
          await requestValue(stores.photos.delete(photo.path));
        });
      });
    },
  };
}
