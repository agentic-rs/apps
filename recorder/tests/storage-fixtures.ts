import type { NativeFileSystem } from '../src/lib/native-storage';

export const audio_asset = {
  path: 'recordings/2026/11/capture.m4a',
  file_name: 'Recording.m4a',
  mime_type: 'audio/mp4',
  duration_ms: 12_000,
  size_bytes: 4,
};

export function legacyRecord() {
  return {
    schema_version: 1,
    id: 'legacy-recording',
    title: 'Original title',
    created_at: '2026-01-01T12:00:00.000Z',
    ...audio_asset,
    source: 'import',
    transcript: {
      text: 'Edited words: 你好',
      language: 'zh',
      segments: [{ start_ms: 0, end_ms: 100, text: 'Original words' }],
      duration_ms: 12_000,
      model_id: 'whisper-tiny-multilingual',
    },
    transcript_edited: true,
  };
}

/** A private-file-store fake that enforces the host's 1,000-entry directory bound. */
export class MemoryFiles implements NativeFileSystem {
  readonly files = new Map<string, Uint8Array>();
  readonly directories = new Set(['']);
  fail_write: ((path: string) => boolean) | null = null;

  async mkdir(path: string) {
    let current = '';
    for (const part of path.split('/')) {
      current = current ? `${current}/${part}` : part;
      this.directories.add(current);
    }
  }

  async write(path: string, input: number[] | Uint8Array) {
    if (this.fail_write?.(path)) throw new Error('Simulated full disk.');
    const parent = path.split('/').slice(0, -1).join('/');
    if (!this.directories.has(parent)) throw new Error('Missing parent directory.');
    const bytes = Uint8Array.from(input);
    this.files.set(path, bytes);
    return { size_bytes: bytes.length };
  }

  async read(path: string, options: { offset?: number; length?: number } = {}) {
    const bytes = this.files.get(path);
    if (!bytes) throw new Error('Missing file.');
    const offset = options.offset ?? 0;
    const result = bytes.slice(offset, offset + (options.length ?? 65_536));
    return { bytes: Array.from(result), eof: offset + result.length >= bytes.length };
  }

  async list(path = '') {
    if (!this.directories.has(path)) throw new Error('Missing directory.');
    const prefix = path ? `${path}/` : '';
    const entries: { name: string; kind: 'file' | 'directory'; size_bytes: number }[] = [];
    for (const directory of this.directories) {
      if (!directory.startsWith(prefix) || directory === path) continue;
      const name = directory.slice(prefix.length);
      if (name && !name.includes('/')) entries.push({ name, kind: 'directory', size_bytes: 0 });
    }
    for (const [file, bytes] of this.files) {
      if (!file.startsWith(prefix)) continue;
      const name = file.slice(prefix.length);
      if (name && !name.includes('/'))
        entries.push({ name, kind: 'file', size_bytes: bytes.length });
    }
    if (entries.length > 1_000) throw new Error('Directory exceeds 1,000 entries.');
    return { entries: entries.sort((a, b) => a.name.localeCompare(b.name)) };
  }

  async remove(path: string) {
    if (!this.files.delete(path)) throw new Error('Missing file.');
  }

  async seed(path: string, value: unknown) {
    await this.mkdir(path.split('/').slice(0, -1).join('/'));
    await this.write(path, new TextEncoder().encode(JSON.stringify(value)));
  }

  async seedAudio(path = audio_asset.path) {
    await this.mkdir(path.split('/').slice(0, -1).join('/'));
    await this.write(path, [1, 2, 3, 4]);
  }
}
