import { parseTopic, requireId } from './model';
import { createSerialQueue, sortTopics } from './storage';
import type { TopicStore } from './types';

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 1);
    let settled = false;
    request.onupgradeneeded = () =>
      request.result.createObjectStore('topics', { keyPath: 'id' });
    request.onerror = () =>
      reject(
        new Error('Browser storage is unavailable. Check storage permissions.'),
      );
    request.onblocked = () => {
      settled = true;
      reject(
        new Error(
          'Close other Learning previews so browser storage can be upgraded.',
        ),
      );
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}

export function createBrowserStore(
  factory: IDBFactory = indexedDB,
  name = 'apell-learning-preview',
): TopicStore {
  const serial = createSerialQueue();
  const transaction = async <T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const database = await openDatabase(factory, name);
    return new Promise((resolve, reject) => {
      let result: T;
      let failure: unknown;
      const transaction = database.transaction('topics', mode);
      transaction.oncomplete = () => {
        database.close();
        resolve(result);
      };
      transaction.onabort = transaction.onerror = () => {
        database.close();
        reject(
          failure ??
            new Error(
              'Could not save browser data. Check available disk space.',
            ),
        );
      };
      try {
        const request = action(transaction.objectStore('topics'));
        request.onsuccess = () => {
          result = request.result;
        };
        request.onerror = () => {
          failure = new Error('Could not access saved learning data.');
        };
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    });
  };
  return {
    list: () =>
      serial(async () =>
        sortTopics(
          (
            await transaction<unknown[]>('readonly', (store) => store.getAll())
          ).map(parseTopic),
        ),
      ),
    save: async (value) => {
      const topic = parseTopic(value);
      await serial(() => transaction('readwrite', (store) => store.put(topic)));
    },
    remove: async (value) => {
      const id = requireId(value);
      await serial(() => transaction('readwrite', (store) => store.delete(id)));
    },
  };
}
