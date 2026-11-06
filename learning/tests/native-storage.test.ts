import { describe, expect, test } from 'bun:test';
import { createTopic } from '../src/lib/model';
import { createNativeStore, nativeTopicPath } from '../src/lib/native-storage';
import { MemoryFiles, savedTopic } from './storage-fixtures';

describe('native learning storage', () => {
  test('reopens conversations and automatic memory without altering provider metadata', async () => {
    const fs = new MemoryFiles();
    fs.chunk_size = 17;
    const topic = savedTopic();
    topic.goal = '学习树木 🌳';
    await createNativeStore(fs).save(topic);
    expect(await createNativeStore(fs).list()).toEqual([topic]);
  });

  test('failed writes retain the last saved version and do not poison retries', async () => {
    const fs = new MemoryFiles();
    const store = createNativeStore(fs);
    const topic = savedTopic();
    await store.save(topic);
    fs.fail_write = true;
    await expect(
      store.save({ ...topic, title: 'Revised title' }),
    ).rejects.toThrow('full disk');
    expect(await store.list()).toEqual([topic]);
    fs.fail_write = false;
    await store.save({ ...topic, title: 'Revised title' });
    expect((await store.list())[0]!.title).toBe('Revised title');
  });

  test('serializes writes and captures data before asynchronous work starts', async () => {
    const fs = new MemoryFiles();
    const store = createNativeStore(fs);
    const topic = savedTopic();
    const first = store.save(topic);
    topic.title = 'Changed after save';
    await first;
    expect((await store.list())[0]!.title).toBe('How trees grow');
    await Promise.all([
      store.save({ ...topic, title: 'First write' }),
      store.save({ ...topic, title: 'Second write' }),
    ]);
    expect((await store.list())[0]!.title).toBe('Second write');
  });

  test('deletes only the selected topic and can retry deletion', async () => {
    const fs = new MemoryFiles();
    const store = createNativeStore(fs);
    const first = savedTopic();
    const second = createTopic('Water cycles');
    await store.save(first);
    await store.save(second);
    await store.remove(first.id);
    await store.remove(first.id);
    expect(await store.list()).toEqual([second]);
    await expect(store.remove('../outside')).rejects.toThrow('identity');
  });

  test('reports corrupt topics instead of silently presenting an empty library', async () => {
    const fs = new MemoryFiles();
    const topic = savedTopic();
    await fs.seed(nativeTopicPath(topic.id), { ...topic, schema_version: 99 });
    await expect(createNativeStore(fs).list()).rejects.toThrow('version');
    await fs.seed(nativeTopicPath(topic.id), { ...topic, id: 'another-topic' });
    await expect(createNativeStore(fs).list()).rejects.toThrow(
      'does not match',
    );
    fs.files.set(nativeTopicPath(topic.id), new Uint8Array([0xff]));
    await expect(createNativeStore(fs).list()).rejects.toThrow();
  });

  test('shards more than 1,000 topics within host listing bounds', async () => {
    const fs = new MemoryFiles();
    const store = createNativeStore(fs);
    for (let index = 0; index < 1_005; index++) {
      await store.save({
        ...createTopic(`Topic ${index}`),
        id: `topic-${index}`,
      });
    }
    expect(await store.list()).toHaveLength(1_005);
  });
});
