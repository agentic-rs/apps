import { expect, test } from 'bun:test';
import { IDBFactory } from 'fake-indexeddb';
import { createBrowserStorage } from '../src/lib/browser-storage';
import { createNativeStore } from '../src/lib/native-storage';
import {
  createChannel,
  createRecording,
  createTextNote,
  groupChannelNotes,
} from '../src/lib/recordings';
import { audio_asset, MemoryFiles } from './storage-fixtures';

const stores = {
  browser: () => {
    const factory = new IDBFactory();
    return () => createBrowserStorage(factory).store;
  },
  native: () => {
    const fs = new MemoryFiles();
    return () => createNativeStore(fs);
  },
};

for (const [name, setup] of Object.entries(stores)) {
  test(`${name} persists text in its channel without creating audio, and deletes it independently`, async () => {
    const open = setup();
    const store = open();
    const channel = createChannel('Ideas');
    const note = createTextNote(channel.id, ' A note\n第二行。  ');
    await expect(store.addTextNote(note)).rejects.toThrow('channel no longer exists');
    await store.saveChannel(channel);
    await store.addTextNote(note);
    const reopened = open();
    expect(await reopened.listTextNotes()).toEqual([{ ...note, text: 'A note\n第二行。' }]);
    expect(await reopened.list()).toEqual([]);
    await expect(reopened.removeChannel(channel.id)).rejects.toThrow('notes');
    await reopened.removeTextNote(note.id);
    await reopened.removeChannel(channel.id);
    expect(await open().listTextNotes()).toEqual([]);
    expect(await open().listChannels()).toEqual([]);
  });
}

test('text and voice notes share chronological order and stay in their original channel', () => {
  const first = { ...createTextNote('ideas', 'First'), created_at: '2026-01-01T10:00:00Z' };
  const last = { ...createTextNote('ideas', 'Last'), created_at: '2026-01-01T12:00:00Z' };
  const other = createTextNote('other', 'Other channel');
  const clip = createRecording(audio_asset, 'microphone', {
    mode: 'clip',
    channel_id: 'ideas',
    started_at: '2026-01-01T11:00:00Z',
  });
  const doc = createRecording(audio_asset, 'import');
  const channels = groupChannelNotes([doc, clip], [last, other, first]);
  expect(channels.size).toBe(2);
  expect(channels.get('ideas')).toEqual([first, clip, last]);
  expect(channels.get('other')).toEqual([other]);
  expect(() => createTextNote('ideas', '  \n')).toThrow();
});
