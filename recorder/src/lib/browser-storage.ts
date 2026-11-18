import {
  isSafePath,
  isValidId,
  parseCaptureDraft,
  parseChannel,
  parseRecording,
  parseTextNote,
} from './recordings';
import { recoverLibrary } from './storage';
import type { AudioAsset, Recording, RecordingStore } from './types';

type StoreName = 'recordings' | 'audio' | 'channels' | 'captures' | 'text_notes';
type StoreMap = Record<StoreName, IDBObjectStore>;
interface SavedAudio {
  schema_version: 1;
  blob: Blob;
  asset: AudioAsset;
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error('Could not access browser storage. Check available disk space.'));
  });
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = factory.open(name, 3);
    request.onupgradeneeded = () => {
      const database = request.result;
      // Additive migration: existing recordings and audio keep their keys/bytes.
      for (const store of ['recordings', 'audio', 'channels', 'captures', 'text_notes'] as const) {
        if (!database.objectStoreNames.contains(store)) {
          const table = database.createObjectStore(
            store,
            store === 'audio' ? undefined : { keyPath: 'id' },
          );
          if (store === 'text_notes') table.createIndex('channel_id', 'channel_id');
        }
      }
    };
    request.onblocked = () => {
      settled = true;
      reject(new Error('Close other recorder previews so browser storage can be upgraded.'));
    };
    request.onerror = () => {
      settled = true;
      reject(new Error('Browser storage is unavailable. Check the browser’s storage permissions.'));
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

/** Inject a factory/name for isolated IndexedDB migration and recovery tests. */
export function createBrowserStorage(
  factory: IDBFactory = indexedDB,
  name = 'apell-recorder-preview',
) {
  const transaction = async <T>(
    names: StoreName[],
    mode: IDBTransactionMode,
    action: (stores: StoreMap) => Promise<T>,
  ): Promise<T> => {
    const database = await openDatabase(factory, name);
    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(names, mode);
      const stores = Object.fromEntries(
        names.map((key) => [key, transaction.objectStore(key)]),
      ) as StoreMap;
      let result: T;
      let failure: unknown;
      transaction.oncomplete = () => {
        database.close();
        resolve(result);
      };
      transaction.onabort = transaction.onerror = () => {
        database.close();
        reject(failure ?? new Error('Could not save browser data. Check available disk space.'));
      };
      // Callers await only IndexedDB requests, so each continuation remains in
      // the current transaction. Recovery metadata and draft removal commit together.
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
  };

  function audioEntry(path: IDBValidKey, value: unknown): { asset: AudioAsset; blob: Blob } {
    if (typeof path !== 'string' || !isSafePath(path))
      throw new Error('Invalid browser audio identity.');
    if (value instanceof Blob) {
      return {
        blob: value,
        asset: {
          path,
          file_name:
            typeof File !== 'undefined' && value instanceof File
              ? value.name
              : 'Recovered recording',
          mime_type: value.type || 'application/octet-stream',
          duration_ms: 0,
          size_bytes: value.size,
        },
      };
    }
    const saved = value as Partial<SavedAudio> | null;
    if (
      !saved ||
      saved.schema_version !== 1 ||
      !(saved.blob instanceof Blob) ||
      !saved.asset ||
      saved.asset.path !== path
    ) {
      throw new Error('Invalid browser audio data.');
    }
    const asset = saved.asset;
    if (
      typeof asset.file_name !== 'string' ||
      typeof asset.mime_type !== 'string' ||
      !Number.isFinite(asset.duration_ms) ||
      asset.duration_ms < 0 ||
      asset.size_bytes !== saved.blob.size
    ) {
      throw new Error('Invalid browser audio metadata.');
    }
    return { blob: saved.blob, asset };
  }

  const store: RecordingStore = {
    list: () =>
      transaction(['recordings', 'captures', 'audio'], 'readwrite', async (stores) => {
        const [values, captured, keys, audio] = await Promise.all([
          requestValue<unknown[]>(stores.recordings.getAll()),
          requestValue<unknown[]>(stores.captures.getAll()),
          requestValue(stores.audio.getAllKeys()),
          requestValue<unknown[]>(stores.audio.getAll()),
        ]);
        return recoverLibrary(
          values.map(parseRecording),
          captured.map(parseCaptureDraft),
          keys.map((key, index) => audioEntry(key, audio[index]).asset),
          async (recording) => {
            await requestValue(stores.recordings.put(parseRecording(recording)));
          },
          async (id) => {
            await requestValue(stores.captures.delete(id));
          },
        );
      }),
    save: (value) =>
      transaction(['recordings', 'captures'], 'readwrite', async (stores) => {
        const recording = parseRecording(value);
        const captured = await requestValue(stores.captures.get(recording.id));
        await requestValue(stores.recordings.put(recording));
        if (captured && parseCaptureDraft(captured).path === recording.path)
          await requestValue(stores.captures.delete(recording.id));
      }),
    remove: (value: Recording) =>
      transaction(['recordings', 'audio', 'captures'], 'readwrite', async (stores) => {
        const recording = parseRecording(value);
        await requestValue(stores.audio.delete(recording.path));
        await requestValue(stores.recordings.delete(recording.id));
        await requestValue(stores.captures.delete(recording.id));
      }),
    listChannels: () =>
      transaction(['channels'], 'readonly', async (stores) =>
        (await requestValue<unknown[]>(stores.channels.getAll()))
          .map(parseChannel)
          .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)),
      ),
    saveChannel: (channel) =>
      transaction(['channels'], 'readwrite', async (stores) => {
        await requestValue(stores.channels.put(parseChannel(channel)));
      }),
    removeChannel: (id) =>
      transaction(
        ['channels', 'recordings', 'captures', 'audio', 'text_notes'],
        'readwrite',
        async (stores) => {
          if (!isValidId(id)) throw new Error('Invalid channel identity.');
          const [recordings, captures, text_count] = await Promise.all([
            requestValue<unknown[]>(stores.recordings.getAll()),
            requestValue<unknown[]>(stores.captures.getAll()),
            requestValue(stores.text_notes.index('channel_id').count(id)),
          ]);
          if (text_count || recordings.map(parseRecording).some((row) => row.channel_id === id)) {
            throw new Error(
              'Delete or move this channel’s notes and finish its capture before removing it.',
            );
          }
          for (const draft of captures
            .map(parseCaptureDraft)
            .filter((row) => row.channel_id === id)) {
            const audio = await requestValue(stores.audio.get(draft.path));
            if (audio && audioEntry(draft.path, audio).asset.size_bytes > 0) {
              throw new Error('Finish this channel’s capture before removing it.');
            }
            await requestValue(stores.captures.delete(draft.id));
          }
          await requestValue(stores.channels.delete(id));
        },
      ),
    listTextNotes: () =>
      transaction(['text_notes'], 'readonly', async (stores) =>
        (await requestValue<unknown[]>(stores.text_notes.getAll())).map(parseTextNote),
      ),
    addTextNote: (value) =>
      transaction(['text_notes', 'channels'], 'readwrite', async (stores) => {
        const note = parseTextNote(value);
        if (!(await requestValue(stores.channels.getKey(note.channel_id))))
          throw new Error('This channel no longer exists.');
        await requestValue(stores.text_notes.add(note));
      }),
    removeTextNote: (id) =>
      transaction(['text_notes'], 'readwrite', async (stores) => {
        if (!isValidId(id)) throw new Error('Invalid text note identity.');
        await requestValue(stores.text_notes.delete(id));
      }),
    saveCapture: (draft) =>
      transaction(['captures'], 'readwrite', async (stores) => {
        await requestValue(stores.captures.put(parseCaptureDraft(draft)));
      }),
    clearCapture: (id) =>
      transaction(['captures'], 'readwrite', async (stores) => {
        if (!isValidId(id)) throw new Error('Invalid capture identity.');
        await requestValue(stores.captures.delete(id));
      }),
  };
  return {
    store,
    saveAudio: (asset: AudioAsset, blob: Blob) =>
      transaction(['audio'], 'readwrite', async (stores) => {
        const saved: SavedAudio = { schema_version: 1, asset, blob };
        audioEntry(asset.path, saved);
        await requestValue(stores.audio.put(saved, asset.path));
      }),
    getBlob: (path: string) =>
      transaction(['audio'], 'readonly', async (stores) => {
        const value = await requestValue(stores.audio.get(path));
        if (!value) throw new Error('The audio file is missing from browser storage.');
        return audioEntry(path, value).blob;
      }),
  };
}
