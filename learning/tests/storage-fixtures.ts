import { createTopic } from '../src/lib/model';
import type { NativeFileSystem } from '../src/lib/native-storage';
import type { Topic } from '../src/lib/types';

export function savedTopic(): Topic {
  return {
    ...createTopic('How trees grow', 'Understand the foundations'),
    model: {
      connection_id: 'test-connection',
      model_id: 'test-model',
      provider_id: 'test-provider',
      provider_name: 'Test provider',
    },
    key_points: [
      {
        id: 'roots',
        title: 'Roots and nutrients',
        description: 'Explore how roots sustain a tree.',
        memory: {
          summary: 'Roots take in water and mineral nutrients.',
          learned: true,
          updated_at: '2026-01-01T00:00:00.000Z',
          source_turn_id: 'turn-one',
        },
        turns: [
          {
            id: 'turn-one',
            created_at: '2026-01-01T00:00:00.000Z',
            user_text:
              'Roots absorb water and mineral nutrients. Is that right?',
            assistant_text: 'Yes, roots absorb water and mineral nutrients.',
            user_message: {
              role: 'user',
              content:
                'Roots absorb water and mineral nutrients. Is that right?',
            },
            assistant_message: {
              role: 'assistant',
              content: 'Yes, roots absorb water and mineral nutrients.',
              provider_state: {
                opaque: [{ signed_text: 'provider-owned-state', sequence: 1 }],
              },
              future_field: ['preserve', { nested_field: true }],
            },
            provenance: {
              connection_id: 'test-connection',
              requested_model_id: 'test-model',
              model_id: null,
            },
          },
        ],
      },
    ],
  };
}

export class MemoryFiles implements NativeFileSystem {
  readonly files = new Map<string, Uint8Array>();
  readonly directories = new Set(['']);
  fail_write = false;
  chunk_size = 65_536;

  async mkdir(path: string) {
    let current = '';
    for (const part of path.split('/')) {
      current = current ? `${current}/${part}` : part;
      this.directories.add(current);
    }
  }

  async write(path: string, input: number[] | Uint8Array) {
    if (this.fail_write) throw new Error('Simulated full disk.');
    if (!this.directories.has(path.split('/').slice(0, -1).join('/')))
      throw new Error('Missing parent.');
    const bytes = Uint8Array.from(input);
    this.files.set(path, bytes);
    return { size_bytes: bytes.length };
  }

  async read(path: string, options: { offset?: number; length?: number } = {}) {
    const bytes = this.files.get(path);
    if (!bytes) throw new Error('Missing file.');
    const offset = options.offset ?? 0;
    const result = bytes.slice(
      offset,
      offset + Math.min(options.length ?? this.chunk_size, this.chunk_size),
    );
    return {
      bytes: Array.from(result),
      eof: offset + result.length >= bytes.length,
    };
  }

  async list(path = '') {
    if (!this.directories.has(path)) throw new Error('Missing directory.');
    const prefix = path ? `${path}/` : '';
    const entries: {
      name: string;
      kind: 'file' | 'directory';
      size_bytes: number;
    }[] = [];
    for (const directory of this.directories) {
      if (!directory.startsWith(prefix) || directory === path) continue;
      const name = directory.slice(prefix.length);
      if (name && !name.includes('/'))
        entries.push({ name, kind: 'directory', size_bytes: 0 });
    }
    for (const [file, bytes] of this.files) {
      if (!file.startsWith(prefix)) continue;
      const name = file.slice(prefix.length);
      if (name && !name.includes('/'))
        entries.push({ name, kind: 'file', size_bytes: bytes.length });
    }
    if (entries.length > 1_000)
      throw new Error('Directory exceeds 1,000 entries.');
    return { entries };
  }

  async remove(path: string) {
    if (!this.files.delete(path)) throw new Error('Missing file.');
  }

  async seed(path: string, value: unknown) {
    await this.mkdir(path.split('/').slice(0, -1).join('/'));
    await this.write(path, new TextEncoder().encode(JSON.stringify(value)));
  }
}
