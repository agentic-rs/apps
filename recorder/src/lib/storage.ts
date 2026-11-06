import { createId, recoverRecording } from './recordings';
import type { AudioAsset, CaptureDraft, Recording } from './types';

/** Serialize read/modify/write recovery with writes made through the same store. */
export function createSerialQueue() {
  let pending: Promise<unknown> = Promise.resolve();
  return <T>(operation: () => Promise<T>): Promise<T> => {
    const next = pending.then(operation);
    pending = next.catch(() => undefined);
    return next;
  };
}

export function sortRecordings(recordings: Recording[]): Recording[] {
  return recordings.sort(
    (left, right) =>
      (right.started_at ?? right.created_at).localeCompare(left.started_at ?? left.created_at) ||
      right.id.localeCompare(left.id),
  );
}

export function storageShard(id: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(id)) hash = Math.imul(hash ^ byte, 0x01000193);
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  return `${hex.slice(0, 2)}/${hex.slice(2, 4)}`;
}

/** Drafts carry the capture intent; apply them before discovering orphan files. */
export async function recoverLibrary(
  recordings: Recording[],
  drafts: CaptureDraft[],
  assets: AudioAsset[],
  persist: (recording: Recording) => Promise<void>,
  clear: (id: string) => Promise<void>,
  options: { clear_missing_captures?: boolean } = {},
): Promise<Recording[]> {
  const by_id = new Map(recordings.map((recording) => [recording.id, recording]));
  const known_paths = new Set(recordings.map((recording) => recording.path));
  const available = new Map(assets.map((asset) => [asset.path, asset]));
  const draft_paths = new Set(drafts.map((draft) => draft.path));
  for (const draft of drafts) {
    const existing = by_id.get(draft.id);
    if (existing && existing.path !== draft.path) {
      throw new Error(
        'A saved capture conflicts with an existing recording. Its audio has been preserved.',
      );
    }
    if (existing || known_paths.has(draft.path)) {
      await clear(draft.id);
      continue;
    }
    const asset = available.get(draft.path);
    if (!asset || !asset.size_bytes) {
      if (options.clear_missing_captures) await clear(draft.id);
      continue;
    }
    const recording = recoverRecording(
      { ...asset, mime_type: draft.mime_type || asset.mime_type },
      draft,
    );
    await persist(recording);
    // The metadata is durable before the draft can be removed, including when
    // recovery is interrupted between these two writes.
    await clear(draft.id);
    by_id.set(recording.id, recording);
    known_paths.add(recording.path);
  }
  for (const asset of assets) {
    if (!asset.size_bytes || known_paths.has(asset.path) || draft_paths.has(asset.path)) continue;
    const recording = recoverRecording(asset);
    while (by_id.has(recording.id)) recording.id = createId();
    await persist(recording);
    by_id.set(recording.id, recording);
    known_paths.add(recording.path);
  }
  return sortRecordings([...by_id.values()]);
}
