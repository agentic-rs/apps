import { describe, expect, test } from 'bun:test';
import { emptyJournal } from '../src/lib/model';
import { createNativeStorage, type NativeFileSystem } from '../src/lib/native-storage';
import { createNativePlatform } from '../src/lib/platform';
import type { Journal, PhotoAsset } from '../src/lib/types';

const photo: PhotoAsset = {
  id: 'photo-a',
  path: 'images/photo-a.jpg',
  mime_type: 'image/jpeg',
  size_bytes: 4,
};
const timestamp = '2026-06-01T08:00:00.000Z';

class MemoryFiles implements NativeFileSystem {
  readonly files = new Map<string, Uint8Array>();
  readonly directories = new Set(['']);
  fail_write = false;
  fail_list = false;
  stalled_read = false;
  read_count = 0;

  async mkdir(path: string) {
    this.directories.add(path);
  }
  async stat(path: string) {
    if (this.directories.has(path)) return { kind: 'directory' as const, size_bytes: 0 };
    const bytes = this.files.get(path);
    if (!bytes) throw new Error('Missing file.');
    return { kind: 'file' as const, size_bytes: bytes.length };
  }
  async list(path = '') {
    if (this.fail_list) throw new Error('Storage is unavailable.');
    if (!this.directories.has(path)) throw new Error('Missing directory.');
    const prefix = path ? `${path}/` : '';
    return {
      entries: [...this.files].flatMap(([name, bytes]) =>
        name.startsWith(prefix) && !name.slice(prefix.length).includes('/')
          ? [{ name: name.slice(prefix.length), kind: 'file' as const, size_bytes: bytes.length }]
          : [],
      ),
    };
  }
  async read(path: string, options: { offset?: number; length?: number } = {}) {
    this.read_count++;
    if (this.stalled_read) return { bytes: [], eof: false };
    const bytes = this.files.get(path);
    if (!bytes) throw new Error('Missing file.');
    const offset = options.offset ?? 0;
    const chunk = bytes.slice(offset, offset + (options.length ?? 65_536));
    return { bytes: [...chunk], eof: offset + chunk.length >= bytes.length };
  }
  async write(path: string, bytes: Uint8Array | number[]) {
    if (this.fail_write) throw new Error('Disk is full.');
    if (!this.directories.has(path.split('/').slice(0, -1).join('/')))
      throw new Error('Missing directory.');
    this.files.set(path, Uint8Array.from(bytes));
    return { size_bytes: bytes.length };
  }
  async remove(path: string) {
    if (!this.files.delete(path)) throw new Error('Missing file.');
  }
}

function journalWithTrip(): Journal {
  return {
    ...emptyJournal(),
    trips: [
      {
        id: 'trip-a',
        title: 'A mountain weekend',
        description: '',
        start_date: '',
        end_date: '',
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
  };
}

describe('native journal storage', () => {
  test('persists, reopens, and retries after an atomic save fails', async () => {
    const files = new MemoryFiles();
    const storage = createNativeStorage(files);
    expect(await storage.load()).toEqual(emptyJournal());
    await storage.save(journalWithTrip());
    files.fail_write = true;
    await expect(storage.save(emptyJournal())).rejects.toThrow('Disk is full');
    files.fail_write = false;
    expect(await createNativeStorage(files).load()).toEqual(journalWithTrip());
    await storage.save(emptyJournal());
    expect(await createNativeStorage(files).load()).toEqual(emptyJournal());
  });

  test('does not overwrite unreadable or corrupt metadata', async () => {
    const files = new MemoryFiles();
    files.files.set('journal/journal.json', new TextEncoder().encode('{ broken'));
    const storage = createNativeStorage(files);
    await expect(storage.load()).rejects.toThrow();
    await expect(storage.save(emptyJournal())).rejects.toThrow('before saving');
    expect(new TextDecoder().decode(files.files.get('journal/journal.json'))).toBe('{ broken');
    files.fail_list = true;
    await expect(storage.load()).rejects.toThrow('unavailable');
  });

  test('reads large photos in chunks and rejects stalled or incomplete reads', async () => {
    const files = new MemoryFiles();
    const bytes = new Uint8Array(700_000).fill(7);
    files.files.set(photo.path, bytes);
    const storage = createNativeStorage(files);
    const large_photo = { ...photo, size_bytes: bytes.length };
    const blob = await storage.readPhoto(large_photo);
    expect(blob.size).toBe(bytes.length);
    expect(files.read_count).toBe(3);
    expect(new Uint8Array(await blob.arrayBuffer())[699_999]).toBe(7);
    await expect(storage.readPhoto(photo)).rejects.toThrow('damaged');
    files.stalled_read = true;
    await expect(storage.readPhoto(large_photo)).rejects.toThrow('finish reading');
  });

  test('removes only images, never a metadata path or traversal', async () => {
    const files = new MemoryFiles();
    files.files.set(photo.path, new Uint8Array(4));
    files.files.set('journal/journal.json', new Uint8Array(4));
    const storage = createNativeStorage(files);
    await expect(storage.removePhoto({ ...photo, path: 'journal/journal.json' })).rejects.toThrow(
      'path',
    );
    await expect(storage.removePhoto({ ...photo, path: 'images/../journal.json' })).rejects.toThrow(
      'path',
    );
    expect(files.files.has('journal/journal.json')).toBe(true);
    await storage.removePhoto(photo);
    expect(files.files.has(photo.path)).toBe(false);
  });

  test('preserves native cancellation and validates a foreground location fix', async () => {
    const files = new MemoryFiles();
    let location_value: {
      latitude: number;
      longitude: number;
      accuracy_m: number;
      timestamp_ms: number;
    } | null = null;
    const platform = createNativePlatform({
      fs: files,
      camera: { capture: async () => null },
      photos: { pick: async () => photo },
      location: { current: async () => location_value },
    });
    expect(await platform.capturePhoto()).toBeNull();
    expect(await platform.currentLocation()).toBeNull();
    expect((await platform.importPhoto())?.path).toBe(photo.path);
    location_value = {
      latitude: 0,
      longitude: 0,
      accuracy_m: 8,
      timestamp_ms: Date.parse(timestamp),
    };
    expect(await platform.currentLocation()).toEqual({
      latitude: 0,
      longitude: 0,
      accuracy_m: 8,
      source: 'device',
      captured_at: timestamp,
    });
    location_value.latitude = 100;
    await expect(platform.currentLocation()).rejects.toThrow('invalid location');
  });
});
