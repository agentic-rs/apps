import { DOMAIN_LIMITS, parseTopic, requireId } from './model';
import { createSerialQueue, sortTopics, storageShard } from './storage';
import type { TopicStore } from './types';

export type NativeFileSystem = Pick<
  typeof import('@apell/sdk').fs,
  'read' | 'write' | 'list' | 'mkdir' | 'remove'
>;
const root = 'learning-topics-v1';

export function nativeTopicPath(id: string): string {
  return `${root}/${storageShard(requireId(id))}/${id}.json`;
}

export function createNativeStore(fs: NativeFileSystem): TopicStore {
  const serial = createSerialQueue();
  const read = async (path: string): Promise<unknown> => {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let offset = 0;
    let text = '';
    for (;;) {
      const result = await fs.read(path, { offset, length: 65_536 });
      offset += result.bytes.length;
      if (offset > DOMAIN_LIMITS.topic_bytes)
        throw new Error('Saved topic exceeds the 8 MiB storage limit.');
      text += decoder.decode(new Uint8Array(result.bytes), {
        stream: !result.eof,
      });
      if (result.eof) return JSON.parse(text);
      if (!result.bytes.length)
        throw new Error('Could not finish reading saved learning data.');
    }
  };
  const paths = async (): Promise<string[]> => {
    await fs.mkdir(root);
    const pending = [{ path: root, depth: 0 }];
    const files: string[] = [];
    while (pending.length) {
      const directory = pending.pop()!;
      for (const entry of (await fs.list(directory.path)).entries) {
        if (entry.kind === 'directory') {
          if (directory.depth >= 2 || !/^[a-f0-9]{2}$/.test(entry.name)) {
            throw new Error('Invalid saved topic directory.');
          }
          pending.push({
            path: `${directory.path}/${entry.name}`,
            depth: directory.depth + 1,
          });
        } else if (entry.name.endsWith('.json')) {
          if (
            directory.depth !== 2 ||
            !/^[a-zA-Z0-9-]{1,128}\.json$/.test(entry.name)
          ) {
            throw new Error('Invalid saved topic filename.');
          }
          if (entry.size_bytes > DOMAIN_LIMITS.topic_bytes) {
            throw new Error('Saved topic exceeds the 8 MiB storage limit.');
          }
          files.push(`${directory.path}/${entry.name}`);
        }
      }
    }
    return files;
  };
  const exists = async (path: string): Promise<boolean> => {
    await fs.mkdir(root);
    const parts = path.split('/').slice(1);
    let directory = root;
    for (let index = 0; index < parts.length; index++) {
      const entry = (await fs.list(directory)).entries.find(
        (entry) => entry.name === parts[index],
      );
      if (!entry) return false;
      if (index === parts.length - 1) {
        if (entry.kind !== 'file')
          throw new Error('Saved topic path is not a file.');
        return true;
      }
      if (entry.kind !== 'directory')
        throw new Error('Saved topic directory is not a directory.');
      directory += `/${parts[index]}`;
    }
    return false;
  };
  return {
    list: () =>
      serial(async () => {
        const topics = [];
        for (const path of await paths()) {
          const topic = parseTopic(await read(path));
          if (nativeTopicPath(topic.id) !== path)
            throw new Error('Saved topic identity does not match its file.');
          topics.push(topic);
        }
        return sortTopics(topics);
      }),
    save: async (value) => {
      const topic = parseTopic(value);
      const path = nativeTopicPath(topic.id);
      const bytes = new TextEncoder().encode(JSON.stringify(topic));
      await serial(async () => {
        await fs.mkdir(path.slice(0, path.lastIndexOf('/')));
        // The host stages, syncs, and atomically replaces each file.
        await fs.write(path, bytes);
      });
    },
    remove: async (id) => {
      const path = nativeTopicPath(id);
      await serial(async () => {
        // Removing a missing topic is safe to retry; avoid masking other FS failures.
        if (await exists(path)) await fs.remove(path);
      });
    },
  };
}
