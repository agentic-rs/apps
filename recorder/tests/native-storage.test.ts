import { describe, expect, test } from 'bun:test';
import { createNativeStore, nativeMetadataPath } from '../src/lib/native-storage';
import { createChannel, createRecording } from '../src/lib/recordings';
import type { CaptureDraft } from '../src/lib/types';
import { audio_asset, legacyRecord, MemoryFiles } from './storage-fixtures';

const capture = (channel_id: string): CaptureDraft => ({
  schema_version: 1,
  id: 'interrupted-capture',
  mode: 'clip',
  channel_id,
  started_at: '2026-02-01T08:30:00.000Z',
  path: audio_asset.path,
  mime_type: audio_asset.mime_type,
});

describe('native recording storage', () => {
  test('reads mixed metadata versions and saves v2 without destroying legacy bytes', async () => {
    const files = new MemoryFiles();
    const legacy = legacyRecord();
    await files.seed(`recorder-metadata/${legacy.id}.json`, legacy);
    await files.seedAudio();
    const original_bytes = files.files.get(`recorder-metadata/${legacy.id}.json`)!.slice();
    const store = createNativeStore(files);
    const [migrated] = await store.list();
    expect(migrated).toMatchObject({
      schema_version: 2,
      mode: 'document',
      transcript: legacy.transcript,
      transcript_edited: true,
    });
    await store.save({ ...migrated!, title: 'New title' });
    expect(files.files.get(`recorder-metadata/${legacy.id}.json`)).toEqual(original_bytes);
    const reopened = await createNativeStore(files).list();
    expect(reopened).toHaveLength(1);
    expect(reopened[0]?.title).toBe('New title');
    expect(files.files.has(nativeMetadataPath('recordings', legacy.id))).toBe(true);
    await store.remove(reopened[0]!);
    expect(await store.list()).toEqual([]);
  });

  test('recovers finalized captures with channel intent before orphan discovery', async () => {
    const files = new MemoryFiles();
    const store = createNativeStore(files);
    const channel = createChannel('Field notes');
    const draft = capture(channel.id);
    await store.saveChannel(channel);
    await store.saveCapture(draft);
    await files.seedAudio();
    const recovered = await store.list();
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({
      id: draft.id,
      mode: 'clip',
      channel_id: channel.id,
      started_at: draft.started_at,
      transcription_state: 'queued',
    });
    expect(files.files.has(nativeMetadataPath('captures', draft.id))).toBe(false);
    expect(await createNativeStore(files).list()).toEqual(recovered);
    await expect(store.removeChannel(channel.id)).rejects.toThrow('Delete or move');
    await store.remove(recovered[0]!);
    await store.removeChannel(channel.id);
    expect(await store.listChannels()).toEqual([]);
  });

  test('failed metadata persistence keeps capture intent and audio for recovery', async () => {
    const files = new MemoryFiles();
    const store = createNativeStore(files);
    const draft = capture('channel-one');
    await store.saveCapture(draft);
    await files.seedAudio();
    files.fail_write = (path) => path.includes('/recordings/');
    await expect(store.list()).rejects.toThrow('full disk');
    expect(files.files.has(nativeMetadataPath('captures', draft.id))).toBe(true);
    expect(files.files.has(draft.path)).toBe(true);
    files.fail_write = null;
    expect((await store.list())[0]?.id).toBe(draft.id);
  });

  test('clears failed empty captures and discovers legacy and sharded orphan files', async () => {
    const files = new MemoryFiles();
    const store = createNativeStore(files);
    const draft = capture('channel-one');
    await store.saveCapture(draft);
    await files.seedAudio('recordings/legacy.m4a');
    await files.seedAudio('recordings/ab/cd/new.wav');
    const rows = await store.list();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.mode === 'document' && row.channel_id === null)).toBe(true);
    expect(files.files.has(nativeMetadataPath('captures', draft.id))).toBe(false);
    expect(await store.list()).toHaveLength(2);
    await store.removeChannel('channel-one');
  });

  test('more than 1,000 recordings stay below the host directory-entry limit', async () => {
    const files = new MemoryFiles();
    const store = createNativeStore(files);
    for (let index = 0; index < 1_005; index++) {
      await store.save(
        createRecording({ ...audio_asset, path: `recordings/missing-${index}.m4a` }, 'microphone', {
          id: `recording-${index}`,
        }),
      );
    }
    expect(await store.list()).toHaveLength(1_005);
    expect(
      (await files.list('recorder-metadata-v2/recordings')).entries.length,
    ).toBeLessThanOrEqual(256);
  });
});
