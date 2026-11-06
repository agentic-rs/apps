import { describe, expect, test } from 'bun:test';
import {
  createNativeTileCache,
  createTileSourceScope,
  createTileSourceWithOptions,
  type CachedTile,
  type TileCache,
  type TileResponse,
  type TileSourceOptions,
} from '../src/lib/map-tiles';

const png = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  ),
);
const coords = { z: 2, x: 1, y: 1 };
const key = '2/1/1';
const epoch = Date.parse('2026-06-01T12:00:00Z');

function response(headers: Record<string, string> = {}, body = png): TileResponse {
  return {
    status: 200,
    headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
    body,
  };
}

class MemoryCache implements TileCache {
  readonly tiles = new Map<string, CachedTile>();
  fail_write = false;
  async read(key: string) {
    return this.tiles.get(key) ?? null;
  }
  async write(key: string, tile: CachedTile) {
    if (this.fail_write) throw new Error('Cache is full.');
    this.tiles.set(key, tile);
  }
  async remove(key: string) {
    this.tiles.delete(key);
  }
}

function deferredTransport() {
  type Request = {
    url: string;
    headers: Parameters<TileSourceOptions['request']>[1];
    signal: AbortSignal;
    resolve: (value: TileResponse) => void;
    reject: (error: Error) => void;
  };
  const requests: Request[] = [];
  const request: TileSourceOptions['request'] = (url, headers, signal) =>
    new Promise((resolve, reject) => {
      requests.push({ url, headers, signal, resolve, reject });
    });
  async function waitFor(count: number) {
    for (let attempt = 0; attempt < 100 && requests.length < count; attempt++) await Bun.sleep(1);
    expect(requests.length).toBe(count);
  }
  return { requests, request, waitFor };
}

class MemoryFiles {
  readonly files = new Map<string, Uint8Array>();
  fail_metadata = false;
  invalid_bytes = false;
  async mkdir(_path: string) {}
  async list(path: string) {
    const prefix = `${path}/`;
    return {
      entries: [...this.files]
        .filter(([name]) => name.startsWith(prefix))
        .map(([name, bytes]) => ({
          name: name.slice(prefix.length),
          kind: 'file' as const,
          size_bytes: bytes.length,
        })),
    };
  }
  async read(path: string, options: { offset?: number; length?: number } = {}) {
    const bytes = this.files.get(path);
    if (!bytes) throw new Error('Missing file.');
    const offset = options.offset ?? 0;
    const result = [...bytes.slice(offset, offset + (options.length ?? 65_536))];
    if (this.invalid_bytes && path.endsWith('.png')) result[0] = 393;
    return { bytes: result, eof: offset + result.length >= bytes.length };
  }
  async write(path: string, bytes: Uint8Array | number[]) {
    if (this.fail_metadata && path.endsWith('.json')) throw new Error('Disk is full.');
    this.files.set(path, Uint8Array.from(bytes));
    return { size_bytes: bytes.length };
  }
  async remove(path: string) {
    this.files.delete(path);
  }
}

describe('map tile loading and caching', () => {
  test('reuses a fresh tile after the reader resumes, including a new source instance', async () => {
    const cache = new MemoryCache();
    let requests = 0;
    const options: TileSourceOptions = {
      cache,
      now: () => epoch,
      request: async () => {
        requests++;
        return response({ 'Cache-Control': 'max-age=3600' });
      },
    };
    const source = createTileSourceWithOptions(options);
    const first = await source.readTile(coords);
    expect(first.type).toBe('image/png');
    expect(await (await source.readTile(coords)).arrayBuffer()).toEqual(await first.arrayBuffer());
    source.dispose();
    const reopened = createTileSourceWithOptions(options);
    expect((await reopened.readTile(coords)).size).toBe(png.length);
    expect(requests).toBe(1);
    reopened.dispose();
  });

  test('honors response age, revalidates expired entries, and keeps the PNG on 304', async () => {
    const cache = new MemoryCache();
    let now = epoch;
    const requested_headers: Parameters<TileSourceOptions['request']>[1][] = [];
    const source = createTileSourceWithOptions({
      cache,
      now: () => now,
      request: async (_url, headers) => {
        requested_headers.push(headers);
        return requested_headers.length === 1
          ? response({
              'Cache-Control': 'max-age=60',
              Date: new Date(epoch - 10_000).toUTCString(),
              Age: '20',
              ETag: '"tile-v1"',
              'Last-Modified': new Date(epoch - 86_400_000).toUTCString(),
            })
          : {
              status: 304,
              headers: [{ name: 'Cache-Control', value: 'max-age=120' }],
              body: new Uint8Array(),
            };
      },
    });
    await source.readTile(coords);
    expect(cache.tiles.get(key)?.expires_at).toBe(epoch + 40_000);
    now += 41_000;
    expect((await source.readTile(coords)).size).toBe(png.length);
    expect(requested_headers[1]).toEqual([
      { name: 'If-None-Match', value: '"tile-v1"' },
      { name: 'If-Modified-Since', value: new Date(epoch - 86_400_000).toUTCString() },
    ]);
    expect(cache.tiles.get(key)?.expires_at).toBe(now + 120_000);
    source.dispose();
  });

  test('uses Expires and preserves its bound on a 304 without freshness headers', async () => {
    const cache = new MemoryCache();
    let now = epoch;
    let count = 0;
    const source = createTileSourceWithOptions({
      cache,
      now: () => now,
      request: async () =>
        ++count === 1
          ? response({ Expires: new Date(epoch + 60_000).toUTCString() })
          : { status: 304, headers: [], body: new Uint8Array() },
    });
    await source.readTile(coords);
    expect(cache.tiles.get(key)?.expires_at).toBe(epoch + 60_000);
    now += 61_000;
    await source.readTile(coords);
    expect(cache.tiles.get(key)?.expires_at).toBe(now);
    source.dispose();
  });

  test('uses a seven-day fallback and never retains no-store responses', async () => {
    const cache = new MemoryCache();
    let count = 0;
    let now = epoch;
    const source = createTileSourceWithOptions({
      cache,
      now: () => now,
      request: async () => response(++count === 1 ? {} : { 'Cache-Control': 'no-store' }),
    });
    await source.readTile(coords);
    expect(cache.tiles.get(key)?.expires_at).toBe(epoch + 7 * 86_400_000);
    now += 8 * 86_400_000;
    await source.readTile(coords);
    expect(cache.tiles.has(key)).toBe(false);
    await source.readTile(coords);
    expect(count).toBe(3);
    source.dispose();
  });

  test('revalidates no-cache responses and ignores disposable storage failures', async () => {
    const cache = new MemoryCache();
    cache.fail_write = true;
    let count = 0;
    const source = createTileSourceWithOptions({
      cache,
      now: () => epoch,
      request: async () => {
        count++;
        return response({ 'Cache-Control': 'no-cache' });
      },
    });
    expect((await source.readTile(coords)).size).toBe(png.length);
    expect((await source.readTile(coords)).size).toBe(png.length);
    expect(count).toBe(2);
    source.dispose();
  });

  test('deduplicates subscribers while cancelling one independently', async () => {
    const transport = deferredTransport();
    const source = createTileSourceWithOptions(transport);
    const abort = new AbortController();
    const first = source.readTile(coords, abort.signal).catch((error) => error);
    const second = source.readTile(coords);
    await transport.waitFor(1);
    abort.abort();
    expect((await first).name).toBe('AbortError');
    transport.requests[0]!.resolve(response());
    expect((await second).size).toBe(png.length);
    expect(transport.requests.length).toBe(1);
    source.dispose();
  });

  test('runs at most two requests and discards cancelled queued tiles', async () => {
    const transport = deferredTransport();
    const source = createTileSourceWithOptions(transport);
    const first = source.readTile({ z: 2, x: 0, y: 0 });
    const second = source.readTile({ z: 2, x: 1, y: 0 });
    const abort = new AbortController();
    const cancelled = source.readTile({ z: 2, x: 2, y: 0 }, abort.signal).catch((error) => error);
    const fourth = source.readTile({ z: 2, x: 3, y: 0 });
    await transport.waitFor(2);
    abort.abort();
    expect((await cancelled).name).toBe('AbortError');
    transport.requests[0]!.resolve(response());
    await first;
    await transport.waitFor(3);
    expect(transport.requests[2]!.url).toBe('https://tile.openstreetmap.org/2/3/0.png');
    transport.requests[1]!.resolve(response());
    transport.requests[2]!.resolve(response());
    await Promise.all([second, fourth]);
    source.dispose();
  });

  test('caches completed active requests after subscribers cancel', async () => {
    const transport = deferredTransport();
    const cache = new MemoryCache();
    const source = createTileSourceWithOptions({ ...transport, cache });
    const abort = new AbortController();
    const cancelled = source.readTile(coords, abort.signal).catch((error) => error);
    await transport.waitFor(1);
    abort.abort();
    expect((await cancelled).name).toBe('AbortError');
    transport.requests[0]!.resolve(response());
    expect((await source.readTile(coords)).size).toBe(png.length);
    expect(transport.requests.length).toBe(1);
    expect(cache.tiles.has(key)).toBe(true);
    source.dispose();
  });

  test('dispose cancels readers and prevents further requests', async () => {
    const transport = deferredTransport();
    const source = createTileSourceWithOptions(transport);
    const result = source.readTile(coords).catch((error) => error);
    await transport.waitFor(1);
    source.dispose();
    expect((await result).name).toBe('AbortError');
    expect(transport.requests[0]!.signal.aborted).toBe(true);
    await expect(source.readTile(coords)).rejects.toHaveProperty('name', 'AbortError');
    transport.requests[0]!.reject(new Error('Cancelled'));
  });

  test('disposing one native view scope preserves another and the shared concurrency bound', async () => {
    const transport = deferredTransport();
    const shared = createTileSourceWithOptions(transport);
    const first = createTileSourceScope(shared);
    const second = createTileSourceScope(shared);
    const cancelled = first.readTile(coords).catch((error) => error);
    const surviving = second.readTile(coords);
    const adjacent = second.readTile({ ...coords, x: 2 });
    const queued = second.readTile({ ...coords, x: 3 });
    await transport.waitFor(2);
    first.dispose();
    expect((await cancelled).name).toBe('AbortError');
    expect(transport.requests[0]!.signal.aborted).toBe(false);
    transport.requests[0]!.resolve(response());
    expect((await surviving).size).toBe(png.length);
    await transport.waitFor(3);
    transport.requests[1]!.resolve(response());
    transport.requests[2]!.resolve(response());
    await Promise.all([adjacent, queued]);
    await expect(first.readTile(coords)).rejects.toHaveProperty('name', 'AbortError');
    second.dispose();
    shared.dispose();
  });

  test('a new reader can join just as a cancelled cache lookup finishes', async () => {
    let finish_read: (tile: CachedTile | null) => void = () => {};
    const lookup = new Promise<CachedTile | null>((resolve) => {
      finish_read = resolve;
    });
    let reads = 0;
    let requests = 0;
    const source = createTileSourceWithOptions({
      cache: {
        read: async () => (++reads === 1 ? lookup : null),
        write: async () => {},
        remove: async () => {},
      },
      request: async () => {
        requests++;
        return response();
      },
    });
    const abort = new AbortController();
    const cancelled = source.readTile(coords, abort.signal).catch((error) => error);
    abort.abort();
    finish_read(null);
    await Promise.resolve();
    expect((await source.readTile(coords)).size).toBe(png.length);
    expect((await cancelled).name).toBe('AbortError');
    expect(requests).toBe(1);
    source.dispose();
  });

  test('bounds the memory cache to 64 entries', async () => {
    let count = 0;
    const source = createTileSourceWithOptions({
      request: async () => {
        count++;
        return response();
      },
    });
    for (let x = 0; x < 65; x++) await source.readTile({ z: 7, x, y: 0 });
    await source.readTile({ z: 7, x: 64, y: 0 });
    expect(count).toBe(65);
    await source.readTile({ z: 7, x: 0, y: 0 });
    expect(count).toBe(66);
    source.dispose();
  });

  test('rejects invalid coordinates and non-image responses without caching them', async () => {
    const cache = new MemoryCache();
    let count = 0;
    const source = createTileSourceWithOptions({
      cache,
      request: async () => {
        count++;
        return count === 1
          ? response({}, new TextEncoder().encode('<html>unavailable</html>'))
          : response();
      },
    });
    await expect(source.readTile({ z: 2, x: -1, y: 0 })).rejects.toThrow('coordinates');
    await expect(source.readTile({ z: 20, x: 0, y: 0 })).rejects.toThrow('coordinates');
    expect(count).toBe(0);
    await expect(source.readTile(coords)).rejects.toThrow('invalid image');
    expect(cache.tiles.size).toBe(0);
    expect((await source.readTile(coords)).size).toBe(png.length);
    source.dispose();
  });

  test('does not convert HTTP failure or an unpaired 304 into a cached image', async () => {
    const cache = new MemoryCache();
    for (const status of [304, 404, 429, 500]) {
      const source = createTileSourceWithOptions({
        cache,
        request: async () => ({ status, headers: [], body: png }),
      });
      await expect(source.readTile(coords)).rejects.toThrow(`status ${status}`);
      expect(cache.tiles.size).toBe(0);
      source.dispose();
    }
  });
});

describe('native map tile cache', () => {
  test('persists binary tiles and metadata, then reads them after reopening', async () => {
    const fs = new MemoryFiles();
    const tile: CachedTile = { body: png, expires_at: epoch, etag: '"saved"' };
    await createNativeTileCache(fs).write(key, tile);
    expect(await createNativeTileCache(fs).read(key)).toEqual({
      ...tile,
      cache_control: undefined,
      expires_header: undefined,
      last_modified: undefined,
    });
    await createNativeTileCache(fs).remove(key);
    expect(await createNativeTileCache(fs).read(key)).toBeNull();
    expect(fs.files.size).toBe(0);
  });

  test('rejects interrupted PNG/metadata pairs, invalid bytes, and oversized metadata', async () => {
    const fs = new MemoryFiles();
    const cache = createNativeTileCache(fs);
    await cache.write(key, { body: png, expires_at: epoch });
    fs.fail_metadata = true;
    await expect(
      cache.write(key, { body: new Uint8Array([...png, 1]), expires_at: epoch }),
    ).rejects.toThrow('full');
    expect(await cache.read(key)).toBeNull();
    fs.fail_metadata = false;
    await cache.write(key, { body: png, expires_at: epoch });
    fs.invalid_bytes = true;
    expect(await cache.read(key)).toBeNull();
    fs.invalid_bytes = false;
    await expect(
      cache.write(key, { body: png, expires_at: epoch, etag: 'x'.repeat(10_000) }),
    ).rejects.toThrow('too large');
    expect((await cache.read(key))?.body).toEqual(png);
  });

  test('bounds storage and never treats a colliding slot as the requested tile', async () => {
    const fs = new MemoryFiles();
    const cache = createNativeTileCache(fs);
    for (let x = 0; x < 300; x++)
      await cache.write(`9/${x}/0`, { body: png, expires_at: epoch, etag: String(x) });
    expect(fs.files.size).toBeLessThanOrEqual(512);
    for (let x = 0; x < 300; x++) {
      const tile = await cache.read(`9/${x}/0`);
      if (tile) expect(tile.etag).toBe(String(x));
    }
  });
});
