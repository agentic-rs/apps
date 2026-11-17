export interface TileCoordinates {
  z: number;
  x: number;
  y: number;
}

export interface MapTileSource {
  readTile(coords: TileCoordinates, signal?: AbortSignal): Promise<Blob>;
  dispose(): void;
}

type Header = { name: string; value: string };
export type TileResponse = { status: number; headers: Header[]; body: Uint8Array };
export type CachedTile = {
  body: Uint8Array;
  expires_at: number;
  cache_control?: string;
  expires_header?: string;
  etag?: string;
  last_modified?: string;
};
export interface TileCache {
  read(key: string): Promise<CachedTile | null>;
  write(key: string, tile: CachedTile): Promise<void>;
  remove(key: string): Promise<void>;
}
export interface TileSourceOptions {
  request(url: string, headers: Header[], signal: AbortSignal): Promise<TileResponse>;
  cache?: TileCache;
  now?: () => number;
}

type Subscriber = {
  resolve: (blob: Blob) => void;
  reject: (error: unknown) => void;
  detach: () => void;
};
type Job = { key: string; subscribers: Set<Subscriber>; started: boolean };
type TileFiles = Pick<
  typeof import('@apell/sdk').fs,
  'read' | 'write' | 'list' | 'mkdir' | 'remove'
>;
const max_tile_bytes = 1_024 * 1_024;
const max_metadata_bytes = 8_192;
const cache_directory = 'map-tiles/v1';
const fallback_lifetime_ms = 7 * 24 * 60 * 60 * 1_000;
const png_signature = [137, 80, 78, 71, 13, 10, 26, 10];

function abortError(): DOMException {
  return new DOMException('Map tile request was cancelled.', 'AbortError');
}

function tileKey({ z, x, y }: TileCoordinates): string {
  if (
    !Number.isInteger(z) ||
    z < 0 ||
    z > 19 ||
    !Number.isInteger(x) ||
    x < 0 ||
    x >= 2 ** z ||
    !Number.isInteger(y) ||
    y < 0 ||
    y >= 2 ** z
  )
    throw new Error('Invalid map tile coordinates.');
  return `${z}/${x}/${y}`;
}

function validPng(body: Uint8Array): boolean {
  return (
    body.length >= 8 &&
    body.length <= max_tile_bytes &&
    png_signature.every((byte, index) => body[index] === byte)
  );
}

function checksum(bytes: Uint8Array): string {
  let value = 2_166_136_261;
  for (const byte of bytes) value = Math.imul(value ^ byte, 16_777_619) >>> 0;
  return value.toString(16);
}

function headerValue(headers: Header[], name: string): string | undefined {
  return headers.find((header) => header.name.toLowerCase() === name)?.value;
}

function cachePolicy(headers: Header[], now: number, previous?: CachedTile) {
  const cache_control = headerValue(headers, 'cache-control') ?? previous?.cache_control;
  const directives = (cache_control ?? '')
    .toLowerCase()
    .split(',')
    .map((value) => value.trim());
  const no_store = directives.includes('no-store');
  const no_cache = directives.some(
    (value) => value === 'no-cache' || value.startsWith('no-cache='),
  );
  const max_age = directives.map((value) => /^max-age="?(\d+)"?$/.exec(value)?.[1]).find(Boolean);
  const date = Date.parse(headerValue(headers, 'date') ?? '');
  const age = Number(headerValue(headers, 'age') ?? 0);
  const elapsed = Math.max(
    Number.isFinite(date) ? now - date : 0,
    Number.isFinite(age) ? age * 1_000 : 0,
    0,
  );
  const expires_header = headerValue(headers, 'expires') ?? previous?.expires_header;
  const expires = Date.parse(expires_header ?? '');
  const lifetime =
    max_age !== undefined
      ? Math.max(0, Number(max_age) * 1_000 - elapsed)
      : Number.isFinite(expires)
        ? Math.max(0, expires - (Number.isFinite(date) ? date : now) - elapsed)
        : fallback_lifetime_ms;
  return {
    no_store,
    cache_control,
    expires_header,
    expires_at: no_cache ? now : now + Math.min(lifetime, Number.MAX_SAFE_INTEGER - now),
    etag: headerValue(headers, 'etag') ?? previous?.etag,
    last_modified: headerValue(headers, 'last-modified') ?? previous?.last_modified,
  };
}

/** Limit tile requests and share them between subscribers. */
export function createTileSourceWithOptions(options: TileSourceOptions): MapTileSource {
  const now = options.now ?? Date.now;
  const memory = new Map<string, CachedTile>();
  const jobs = new Map<string, Job>();
  const queue: Job[] = [];
  const controller = new AbortController();
  let active = 0;
  let disposed = false;

  function remember(key: string, tile: CachedTile) {
    if (disposed) return;
    memory.delete(key);
    memory.set(key, tile);
    while (memory.size > 64) memory.delete(memory.keys().next().value!);
  }

  async function load(job: Job): Promise<Blob | undefined> {
    let cached = memory.get(job.key);
    if (!cached && options.cache)
      cached = (await options.cache.read(job.key).catch(() => null)) ?? undefined;
    if (cached && (!validPng(cached.body) || !Number.isFinite(cached.expires_at)))
      cached = undefined;
    if (cached && cached.expires_at > now()) {
      remember(job.key, cached);
      return new Blob([Uint8Array.from(cached.body)], { type: 'image/png' });
    }
    if (!job.subscribers.size || disposed) return;
    const headers: Header[] = [];
    if (cached?.etag) headers.push({ name: 'If-None-Match', value: cached.etag });
    if (cached?.last_modified)
      headers.push({ name: 'If-Modified-Since', value: cached.last_modified });
    const response = await options.request(
      `https://tile.openstreetmap.org/${job.key}.png`,
      headers,
      controller.signal,
    );
    if (response.status !== 200 && !(response.status === 304 && cached)) {
      throw new Error(`The map tile service returned status ${response.status}.`);
    }
    const body = response.status === 304 ? cached!.body : response.body;
    if (!validPng(body)) throw new Error('The map tile service returned an invalid image.');
    const policy = cachePolicy(
      response.headers,
      now(),
      response.status === 304 ? cached : undefined,
    );
    const { no_store, ...metadata } = policy;
    const tile: CachedTile = { body, ...metadata };
    if (no_store) {
      memory.delete(job.key);
      await options.cache?.remove(job.key).catch(() => undefined);
    } else {
      remember(job.key, tile);
      // A failed disposable cache write must never hide a successfully downloaded map.
      await options.cache?.write(job.key, tile).catch(() => undefined);
    }
    return new Blob([Uint8Array.from(body)], { type: 'image/png' });
  }

  function drain() {
    while (!disposed && active < 2 && queue.length) {
      const job = queue.shift()!;
      if (!job.subscribers.size) continue;
      job.started = true;
      active++;
      function finish(error?: unknown, blob?: Blob) {
        if (!disposed && error === undefined && !blob && job.subscribers.size) {
          // A new reader can arrive just after the last reader cancelled a cache lookup.
          active--;
          job.started = false;
          queue.unshift(job);
          drain();
          return;
        }
        // Remove the completed job before waking readers that can request it again.
        if (jobs.get(job.key) === job) jobs.delete(job.key);
        active--;
        const subscribers = [...job.subscribers];
        job.subscribers.clear();
        for (const subscriber of subscribers) {
          subscriber.detach();
          if (error !== undefined) subscriber.reject(error);
          else if (blob) subscriber.resolve(blob);
          else subscriber.reject(abortError());
        }
        drain();
      }
      void load(job).then(
        (blob) => finish(undefined, blob),
        (error) => finish(error),
      );
    }
  }

  return {
    readTile(coords, signal) {
      if (disposed || signal?.aborted) return Promise.reject(abortError());
      let key: string;
      try {
        key = tileKey(coords);
      } catch (error) {
        return Promise.reject(error);
      }
      let job = jobs.get(key);
      if (!job) {
        job = { key, subscribers: new Set(), started: false };
        jobs.set(key, job);
        queue.push(job);
      }
      const current = job;
      const result = new Promise<Blob>((resolve, reject) => {
        const subscriber: Subscriber = {
          resolve,
          reject,
          detach: () => signal?.removeEventListener('abort', cancel),
        };
        const cancel = () => {
          current.subscribers.delete(subscriber);
          subscriber.detach();
          reject(abortError());
          if (!current.started && !current.subscribers.size) {
            const index = queue.indexOf(current);
            if (index >= 0) queue.splice(index, 1);
            jobs.delete(key);
          }
        };
        current.subscribers.add(subscriber);
        signal?.addEventListener('abort', cancel, { once: true });
      });
      drain();
      return result;
    },
    dispose() {
      disposed = true;
      controller.abort();
      queue.length = 0;
      for (const job of jobs.values()) {
        for (const subscriber of job.subscribers) {
          subscriber.detach();
          subscriber.reject(abortError());
        }
        job.subscribers.clear();
      }
      jobs.clear();
      memory.clear();
    },
  };
}

/** Fixed slots cap the cache at 512 files; paired checksums reject interrupted replacements. */
export function createNativeTileCache(fs: TileFiles): TileCache {
  let pending: Promise<unknown> = Promise.resolve();
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = pending.then(operation);
    pending = next.catch(() => undefined);
    return next;
  }
  function paths(key: string) {
    const slot = parseInt(checksum(new TextEncoder().encode(key)), 16) % 256;
    return { metadata: `${cache_directory}/${slot}.json`, image: `${cache_directory}/${slot}.png` };
  }
  async function readFile(path: string, max_size: number): Promise<Uint8Array | null> {
    const name = path.slice(cache_directory.length + 1);
    const { entries } = await fs.list(cache_directory);
    const entry = entries.find((value) => value.name === name);
    if (!entry) return null;
    if (
      entry.kind !== 'file' ||
      !Number.isSafeInteger(entry.size_bytes) ||
      entry.size_bytes < 0 ||
      entry.size_bytes > max_size
    )
      return null;
    const result = await fs.read(path, { length: Math.min(max_size, entry.size_bytes + 1) });
    if (
      !result.eof ||
      result.bytes.length !== entry.size_bytes ||
      result.bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
    )
      return null;
    return Uint8Array.from(result.bytes);
  }
  async function readMetadata(key: string) {
    await fs.mkdir(cache_directory);
    const bytes = await readFile(paths(key).metadata, max_metadata_bytes);
    if (!bytes) return null;
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== 'object') return null;
    const metadata = value as Record<string, unknown>;
    if (
      metadata.key !== key ||
      typeof metadata.expires_at !== 'number' ||
      !Number.isFinite(metadata.expires_at) ||
      typeof metadata.body_checksum !== 'string'
    )
      return null;
    for (const name of ['cache_control', 'expires_header', 'etag', 'last_modified']) {
      if (metadata[name] !== undefined && typeof metadata[name] !== 'string') return null;
    }
    return metadata as { key: string; body_checksum: string } & Omit<CachedTile, 'body'>;
  }
  return {
    read: (key) =>
      serial(async () => {
        const metadata = await readMetadata(key);
        if (!metadata) return null;
        const body = await readFile(paths(key).image, max_tile_bytes);
        if (!body || !validPng(body) || checksum(body) !== metadata.body_checksum) return null;
        return {
          body,
          expires_at: metadata.expires_at,
          cache_control: metadata.cache_control,
          expires_header: metadata.expires_header,
          etag: metadata.etag,
          last_modified: metadata.last_modified,
        };
      }),
    write: (key, tile) =>
      serial(async () => {
        if (!validPng(tile.body)) throw new Error('Invalid map tile cache image.');
        const { body, ...metadata } = tile;
        const bytes = new TextEncoder().encode(
          JSON.stringify({ key, ...metadata, body_checksum: checksum(body) }),
        );
        if (bytes.length > max_metadata_bytes)
          throw new Error('Map tile cache metadata is too large.');
        await fs.mkdir(cache_directory);
        await fs.write(paths(key).image, body);
        await fs.write(paths(key).metadata, bytes);
      }),
    remove: (key) =>
      serial(async () => {
        if (!(await readMetadata(key))) return;
        await fs.remove(paths(key).metadata);
        await fs.remove(paths(key).image).catch(() => undefined);
      }),
  };
}

/** Closing a view cancels its readers while shared native downloads can finish caching. */
export function createTileSourceScope(source: MapTileSource): MapTileSource {
  const readers = new Set<AbortController>();
  let disposed = false;
  return {
    readTile(coords, signal) {
      if (disposed || signal?.aborted) return Promise.reject(abortError());
      const controller = new AbortController();
      const cancel = () => controller.abort();
      readers.add(controller);
      signal?.addEventListener('abort', cancel, { once: true });
      return source.readTile(coords, controller.signal).finally(() => {
        readers.delete(controller);
        signal?.removeEventListener('abort', cancel);
      });
    },
    dispose() {
      disposed = true;
      for (const controller of readers) controller.abort();
      readers.clear();
    },
  };
}

let native_source: MapTileSource | undefined;

export function createTileSource(native: boolean): MapTileSource {
  if (!native) {
    return createTileSourceWithOptions({
      async request(url, _headers, signal) {
        // Browser HTTP caching owns freshness and validation; do not bypass it.
        const response = await fetch(url, { signal, cache: 'default' });
        const body = new Uint8Array(await response.arrayBuffer());
        return {
          status: response.status,
          headers: [...response.headers].map(([name, value]) => ({ name, value })),
          body,
        };
      },
    });
  }
  native_source ??= createNativeSource();
  return createTileSourceScope(native_source);
}

function createNativeSource(): MapTileSource {
  let host: Promise<typeof import('@apell/sdk')> | undefined;
  const getHost = () => (host ??= import('@apell/sdk'));
  let cache: Promise<TileCache> | undefined;
  const getCache = () => (cache ??= getHost().then((sdk) => createNativeTileCache(sdk.fs)));
  return createTileSourceWithOptions({
    cache: {
      read: async (key) => (await getCache()).read(key),
      write: async (key, tile) => (await getCache()).write(key, tile),
      remove: async (key) => (await getCache()).remove(key),
    },
    async request(url, headers) {
      const response = await (
        await getHost()
      ).http.request({
        url,
        headers: [{ name: 'User-Agent', value: 'Fieldnotes/0.2 (Apell applet)' }, ...headers],
        timeout_ms: 20_000,
      });
      if (
        response.body.length > max_tile_bytes ||
        response.body.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
      )
        throw new Error('The map tile service returned invalid image bytes.');
      return { ...response, body: Uint8Array.from(response.body) };
    },
  });
}
