import type { Topic } from './types';

/** Preserve mutation order and keep a failed save from poisoning later retries. */
export function createSerialQueue() {
  let pending: Promise<unknown> = Promise.resolve();
  return <T>(operation: () => Promise<T>): Promise<T> => {
    const next = pending.then(operation);
    pending = next.catch(() => undefined);
    return next;
  };
}

export function sortTopics(topics: Topic[]): Topic[] {
  return topics.sort(
    (a, b) =>
      b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id),
  );
}

/** Keep each private directory below the host's bounded listing size. */
export function storageShard(id: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(id))
    hash = Math.imul(hash ^ byte, 0x01000193);
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  return `${hex.slice(0, 2)}/${hex.slice(2, 4)}`;
}
