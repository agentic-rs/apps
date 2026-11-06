import { describe, expect, test } from 'bun:test';
import { IDBFactory } from 'fake-indexeddb';
import { createBrowserStorage } from '../src/lib/browser-storage';
import { createChannel, createRecording } from '../src/lib/recordings';
import type { CaptureDraft } from '../src/lib/types';
import { audio_asset, legacyRecord } from './storage-fixtures';

async function seedVersionOne(factory: IDBFactory, name: string) {
  const record = legacyRecord();
  const blob = new Blob(['test'], { type: 'audio/mp4' });
  await new Promise<void>((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('recordings', { keyPath: 'id' }).put(record);
      request.result.createObjectStore('audio').put(blob, record.path);
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
  });
  return { record, blob };
}

const draft = (channel_id: string): CaptureDraft => ({
  schema_version: 1,
  id: 'captured-clip',
  mode: 'clip',
  channel_id,
  started_at: '2026-02-01T10:30:00.000Z',
  path: audio_asset.path,
  mime_type: audio_asset.mime_type,
});

describe('browser IndexedDB storage', () => {
  test('additive v1 upgrade preserves edited transcripts and audio bytes', async () => {
    const factory = new IDBFactory();
    const { record } = await seedVersionOne(factory, 'upgrade');
    const storage = createBrowserStorage(factory, 'upgrade');
    const [migrated] = await storage.store.list();
    expect(migrated).toMatchObject({
      schema_version: 2,
      mode: 'document',
      transcription_state: 'complete',
      transcript: record.transcript,
      transcript_edited: true,
    });
    expect(await (await storage.getBlob(record.path)).text()).toBe('test');
    await storage.store.save({ ...migrated!, title: 'Saved again', transcription_language: 'zh' });
    expect((await createBrowserStorage(factory, 'upgrade').store.list())[0]).toMatchObject({
      title: 'Saved again',
      transcription_language: 'zh',
    });
    expect(await storage.store.listChannels()).toEqual([]);
  });

  test('recovers finalized clips across reopen, preserving audio duration and channel', async () => {
    const factory = new IDBFactory();
    const storage = createBrowserStorage(factory, 'capture');
    const channel = createChannel('Thoughts');
    const capture = draft(channel.id);
    await storage.store.saveChannel(channel);
    await storage.store.saveCapture(capture);
    await storage.saveAudio(audio_asset, new Blob(['test'], { type: 'audio/mp4' }));
    const reopened = createBrowserStorage(factory, 'capture');
    const [recording] = await reopened.store.list();
    expect(recording).toMatchObject({
      id: capture.id,
      mode: 'clip',
      channel_id: channel.id,
      duration_ms: 12_000,
      transcription_state: 'queued',
    });
    expect(await reopened.store.listChannels()).toEqual([channel]);
    expect(await reopened.store.list()).toEqual([recording!]);
    await expect(reopened.store.removeChannel(channel.id)).rejects.toThrow('Delete or move');
    await reopened.store.remove(recording!);
    await reopened.store.removeChannel(channel.id);
    expect(await reopened.store.list()).toEqual([]);
    await expect(reopened.getBlob(audio_asset.path)).rejects.toThrow('missing');
  });

  test('invalid metadata writes retain drafts and finalized audio', async () => {
    const factory = new IDBFactory();
    const storage = createBrowserStorage(factory, 'failed-write');
    const capture = draft('channel-one');
    await storage.store.saveCapture(capture);
    await storage.saveAudio(audio_asset, new Blob(['test']));
    const invalid = {
      ...createRecording(audio_asset, 'microphone', capture),
      transcription_revision: -1,
    };
    await expect(storage.store.save(invalid)).rejects.toThrow('Invalid recording');
    const [recovered] = await storage.store.list();
    expect(recovered).toMatchObject({
      id: capture.id,
      channel_id: capture.channel_id,
      transcription_state: 'queued',
    });
  });

  test('concurrent recovery transactions do not duplicate orphan audio', async () => {
    const factory = new IDBFactory();
    const first = createBrowserStorage(factory, 'concurrent');
    const second = createBrowserStorage(factory, 'concurrent');
    await first.saveAudio(audio_asset, new Blob(['test']));
    const [a, b] = await Promise.all([first.store.list(), second.store.list()]);
    expect(a).toHaveLength(1);
    expect(b).toEqual(a);
    expect(a[0]?.mode).toBe('document');
    expect(await first.store.list()).toHaveLength(1);
  });
});

test('an empty failed capture does not permanently prevent channel deletion', async () => {
  const factory = new IDBFactory();
  const storage = createBrowserStorage(factory, 'empty-capture');
  const channel = createChannel('Empty channel');
  await storage.store.saveChannel(channel);
  await storage.store.saveCapture(draft(channel.id));
  // Listing alone preserves another tab's pending intent. Explicit deletion of
  // an empty channel can clear a draft that has no finalized audio.
  expect(await storage.store.list()).toEqual([]);
  await storage.store.removeChannel(channel.id);
  expect(await storage.store.listChannels()).toEqual([]);
  await storage.saveAudio(audio_asset, new Blob(['test']));
  expect((await storage.store.list())[0]?.mode).toBe('document');
});
