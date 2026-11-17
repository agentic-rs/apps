import { emptyJournal, max_photo_bytes, parseJournal, parsePhotoAsset } from './model';
import type { Journal, PhotoAsset } from './types';

export type NativeFileSystem = Pick<
  typeof import('@apell/sdk').fs,
  'read' | 'write' | 'list' | 'mkdir' | 'stat' | 'remove'
>;

const journal_directory = 'journal';
const journal_path = `${journal_directory}/journal.json`;
const max_snapshot_bytes = 16 * 1_024 * 1_024;

/** Sensor imports belong only to the images directory; never remove metadata paths. */
export function assertPhotoPath(photo: PhotoAsset): void {
  parsePhotoAsset(photo);
}

export function createNativeStorage(fs: NativeFileSystem) {
  let loaded = false;
  let pending: Promise<unknown> = Promise.resolve();

  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = pending.then(operation);
    pending = next.catch(() => undefined);
    return next;
  }

  async function readBytes(
    path: string,
    expected_size: number,
    max_size: number,
  ): Promise<Uint8Array<ArrayBuffer>[]> {
    if (!Number.isSafeInteger(expected_size) || expected_size < 0 || expected_size > max_size) {
      throw new Error('The saved file is too large to open.');
    }
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let offset = 0;
    for (;;) {
      const result = await fs.read(path, { offset, length: 256 * 1_024 });
      if (result.bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
        throw new Error('The host returned invalid file bytes.');
      }
      const chunk = Uint8Array.from(result.bytes);
      offset += chunk.length;
      if (offset > expected_size || offset > max_size)
        throw new Error('The file changed while it was being read.');
      chunks.push(chunk);
      if (result.eof) {
        if (offset !== expected_size) throw new Error('The saved file is incomplete.');
        return chunks;
      }
      if (!chunk.length) throw new Error('Could not finish reading the saved file.');
    }
  }

  return {
    load: () =>
      serial(async () => {
        loaded = false;
        await fs.mkdir(journal_directory);
        // A successful directory listing distinguishes a new journal from an I/O error.
        const { entries } = await fs.list(journal_directory);
        const saved = entries.find((entry) => entry.name === 'journal.json');
        if (!saved) {
          loaded = true;
          return emptyJournal();
        }
        if (saved.kind !== 'file') throw new Error('The journal metadata is not a regular file.');
        const chunks = await readBytes(journal_path, saved.size_bytes, max_snapshot_bytes);
        const text = await new Blob(chunks).text();
        const journal = parseJournal(JSON.parse(text));
        loaded = true;
        return journal;
      }),
    save: (value: Journal) => {
      const journal = parseJournal(value);
      const bytes = new TextEncoder().encode(JSON.stringify(journal));
      return serial(async () => {
        if (!loaded) throw new Error('Open the saved journal successfully before saving changes.');
        if (bytes.length > max_snapshot_bytes)
          throw new Error('The journal metadata exceeds the 16 MiB storage limit.');
        await fs.mkdir(journal_directory);
        // Apell fs.write stages, syncs, and atomically replaces the snapshot.
        await fs.write(journal_path, bytes);
      });
    },
    readPhoto: async (photo: PhotoAsset): Promise<Blob> => {
      assertPhotoPath(photo);
      const stat = await fs.stat(photo.path);
      if (stat.kind !== 'file' || stat.size_bytes !== photo.size_bytes) {
        throw new Error('This photo is missing or damaged in private storage.');
      }
      return new Blob(await readBytes(photo.path, stat.size_bytes, max_photo_bytes), {
        type: photo.mime_type,
      });
    },
    removePhoto: async (photo: PhotoAsset) => {
      assertPhotoPath(photo);
      await fs.remove(photo.path);
    },
  };
}
