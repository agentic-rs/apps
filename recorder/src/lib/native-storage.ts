import {
  isSafePath,
  isValidId,
  parseCaptureDraft,
  parseChannel,
  parseRecording,
} from './recordings';
import { createSerialQueue, recoverLibrary, storageShard } from './storage';
import type { AudioAsset, CaptureDraft, Channel, Recording, RecordingStore } from './types';

export type NativeFileSystem = Pick<
  typeof import('@apell/sdk').fs,
  'read' | 'write' | 'list' | 'mkdir' | 'remove'
>;
type FileEntry = { path: string; size_bytes: number };
const legacy_root = 'recorder-metadata';
const metadata_root = 'recorder-metadata-v2';
const export_root = 'recorder-exports';
type MetadataKind = 'recordings' | 'channels' | 'captures';

export function nativeMetadataPath(kind: MetadataKind, id: string): string {
  if (!isValidId(id)) throw new Error('Invalid saved identity.');
  return `${metadata_root}/${kind}/${storageShard(id)}/${id}.json`;
}

export function nativeExportPath(id: string): string {
  if (!isValidId(id)) throw new Error('Invalid saved identity.');
  return `recorder-exports-v2/${storageShard(id)}/${id}.txt`;
}

export function createNativeStore(fs: NativeFileSystem): RecordingStore {
  const serial = createSerialQueue();
  const readJson = async (path: string): Promise<unknown> => {
    const decoder = new TextDecoder();
    let offset = 0;
    let text = '';
    for (;;) {
      const result = await fs.read(path, { offset, length: 65_536 });
      text += decoder.decode(new Uint8Array(result.bytes), { stream: !result.eof });
      offset += result.bytes.length;
      if (offset > 8 * 1_024 * 1_024) throw new Error('Recording metadata is too large.');
      if (result.eof) return JSON.parse(text);
      if (!result.bytes.length) throw new Error('Could not finish reading recording metadata.');
    }
  };
  const walk = async (root: string): Promise<FileEntry[]> => {
    await fs.mkdir(root);
    const pending = [root];
    const files: FileEntry[] = [];
    while (pending.length) {
      const directory = pending.pop()!;
      const { entries } = await fs.list(directory);
      for (const entry of entries) {
        if (entry.name.includes('/') || !isSafePath(entry.name))
          throw new Error('Invalid stored file name.');
        const path = `${directory}/${entry.name}`;
        if (entry.kind === 'directory') pending.push(path);
        else files.push({ path, size_bytes: entry.size_bytes });
      }
    }
    return files.sort((a, b) => a.path.localeCompare(b.path));
  };
  const exists = async (path: string): Promise<boolean> => {
    const parts = path.split('/');
    let parent = '';
    for (let index = 0; index < parts.length; index++) {
      const { entries } = await fs.list(parent);
      const entry = entries.find((candidate) => candidate.name === parts[index]);
      if (!entry) return false;
      if (index === parts.length - 1) return true;
      if (entry.kind !== 'directory') return false;
      parent = parent ? `${parent}/${parts[index]}` : parts[index];
    }
    return false;
  };
  const removeIfPresent = async (path: string) => {
    if (await exists(path)) await fs.remove(path);
  };
  const write = async (kind: MetadataKind, value: { id: string }) => {
    const path = nativeMetadataPath(kind, value.id);
    await fs.mkdir(path.slice(0, path.lastIndexOf('/')));
    await fs.write(path, new TextEncoder().encode(JSON.stringify(value)));
  };
  const readMetadata = async <T extends { id: string }>(
    root: string,
    parse: (value: unknown) => T,
  ): Promise<T[]> => {
    const rows: T[] = [];
    for (const file of await walk(root)) {
      const name = file.path.split('/').at(-1)!;
      if (!/^[a-zA-Z0-9-]+\.json$/.test(name)) continue;
      const row = parse(await readJson(file.path));
      if (`${row.id}.json` !== name) throw new Error('Saved metadata has an invalid identity.');
      rows.push(row);
    }
    return rows;
  };
  const readRecordings = async () => {
    const legacy = await readMetadata(legacy_root, parseRecording);
    const current = await readMetadata(`${metadata_root}/recordings`, parseRecording);
    // A v2 write supersedes the preserved legacy metadata for the same ID.
    return [...new Map([...legacy, ...current].map((row) => [row.id, row])).values()];
  };
  const readCaptures = () => readMetadata(`${metadata_root}/captures`, parseCaptureDraft);
  const clearCapture = (id: string) => removeIfPresent(nativeMetadataPath('captures', id));
  const save = async (value: Recording) => {
    const recording = parseRecording(value);
    await write('recordings', recording);
    const path = nativeMetadataPath('captures', recording.id);
    if (await exists(path)) {
      const draft = parseCaptureDraft(await readJson(path));
      if (draft.path === recording.path) await clearCapture(recording.id);
    }
  };
  const audioAssets = async (): Promise<AudioAsset[]> => {
    const mime_types: Record<string, string> = {
      m4a: 'audio/mp4',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      flac: 'audio/flac',
      ogg: 'audio/ogg',
      aac: 'audio/aac',
    };
    const files = await walk('recordings');
    return files.flatMap((file) => {
      const name = file.path.split('/').at(-1)!;
      const extension = name.split('.').at(-1)?.toLowerCase() ?? '';
      const mime_type = mime_types[extension];
      return mime_type
        ? [{ ...file, file_name: `Recovered recording.${extension}`, mime_type, duration_ms: 0 }]
        : [];
    });
  };
  return {
    list: () =>
      serial(async () =>
        recoverLibrary(
          await readRecordings(),
          await readCaptures(),
          await audioAssets(),
          save,
          clearCapture,
          { clear_missing_captures: true },
        ),
      ),
    save: (recording) => serial(() => save(recording)),
    remove: (value) =>
      serial(async () => {
        const recording = parseRecording(value);
        await removeIfPresent(`${export_root}/${recording.id}.txt`);
        await removeIfPresent(nativeExportPath(recording.id));
        // Audio first: failed removal keeps metadata available for a retry.
        await removeIfPresent(recording.path);
        for (const file of await walk(legacy_root)) {
          if (file.path.split('/').at(-1) === `${recording.id}.json`) await fs.remove(file.path);
        }
        await removeIfPresent(nativeMetadataPath('recordings', recording.id));
        await clearCapture(recording.id);
      }),
    listChannels: () =>
      serial(async () =>
        (await readMetadata(`${metadata_root}/channels`, parseChannel)).sort(
          (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
        ),
      ),
    saveChannel: (channel) => serial(() => write('channels', parseChannel(channel))),
    removeChannel: (id) =>
      serial(async () => {
        if (!isValidId(id)) throw new Error('Invalid channel identity.');
        const recordings = await readRecordings();
        const captures = (await readCaptures()).filter((row) => row.channel_id === id);
        const paths = new Set(
          (await audioAssets()).filter((asset) => asset.size_bytes > 0).map((asset) => asset.path),
        );
        if (
          recordings.some((row) => row.channel_id === id) ||
          captures.some((draft) => paths.has(draft.path))
        ) {
          throw new Error(
            'Delete or move this channel’s clips and finish its capture before removing it.',
          );
        }
        for (const draft of captures) await clearCapture(draft.id);
        await removeIfPresent(nativeMetadataPath('channels', id));
      }),
    saveCapture: (draft) => serial(() => write('captures', parseCaptureDraft(draft))),
    clearCapture: (id) => serial(() => clearCapture(id)),
  };
}
