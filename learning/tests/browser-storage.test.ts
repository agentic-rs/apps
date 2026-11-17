import { describe, expect, test } from 'bun:test';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createBrowserStore } from '../src/lib/browser-storage';
import { createTopic } from '../src/lib/model';
import { savedTopic } from './storage-fixtures';

describe('browser learning storage', () => {
  test('persists per-topic conversations, model selection, and learning memory across reloads', async () => {
    const factory = new IDBFactory();
    const store = createBrowserStore(factory, 'roundtrip');
    const first = savedTopic();
    const second = createTopic('Water cycles');
    await store.save(first);
    await store.save(second);
    expect(
      await createBrowserStore(factory, 'roundtrip').list(),
    ).toContainEqual(first);
    await store.remove(second.id);
    expect(await store.list()).toEqual([first]);
    await store.remove(second.id);
    expect(await store.list()).toEqual([first]);
  });

  test('snapshots writes and preserves ordering', async () => {
    const factory = new IDBFactory();
    const store = createBrowserStore(factory, 'ordering');
    const topic = savedTopic();
    const pending = store.save(topic);
    topic.title = 'Changed after save';
    await pending;
    expect((await store.list())[0]!.title).toBe('How trees grow');
    await Promise.all([
      store.save({ ...topic, title: 'First write' }),
      store.save({ ...topic, title: 'Second write' }),
    ]);
    expect((await store.list())[0]!.title).toBe('Second write');
  });

  test('rejects an aborted write and allows a later retry without losing durable data', async () => {
    const factory = new IDBFactory();
    const store = createBrowserStore(factory, 'failure');
    const topic = savedTopic();
    await store.save(topic);
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const request = original.apply(this, args);
      this.transaction.abort();
      return request;
    };
    try {
      await expect(
        store.save({ ...topic, title: 'Not saved' }),
      ).rejects.toThrow();
    } finally {
      IDBObjectStore.prototype.put = original;
    }
    expect(await store.list()).toEqual([topic]);
    await store.save({ ...topic, title: 'Retry saved' });
    expect((await store.list())[0]!.title).toBe('Retry saved');
  });

  test('surfaces malformed saved data instead of dropping topics', async () => {
    const factory = new IDBFactory();
    const store = createBrowserStore(factory, 'corrupt');
    await store.list();
    await new Promise<void>((resolve, reject) => {
      const open = factory.open('corrupt', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const database = open.result;
        const transaction = database.transaction('topics', 'readwrite');
        transaction
          .objectStore('topics')
          .put({ id: 'invalid-topic', schema_version: 99 });
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
    await expect(store.list()).rejects.toThrow('version');
  });
});
