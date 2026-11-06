import { expect, test } from 'bun:test';
import { listNativeFiles } from '../src/lib/native-files';

test('native adapter traverses large old recording folders through all pages', async () => {
  const entries = Array.from({ length: 2000 }, (_, index) => ({
    name: `file-${String(index).padStart(4, '0')}`,
    kind: 'file' as const,
    size_bytes: index,
  }));
  const requests: Record<string, unknown>[] = [];
  const result = await listNativeFiles(async (params) => {
    requests.push(params);
    return params.cursor
      ? { entries: entries.slice(1000), next_cursor: null }
      : { entries: entries.slice(0, 1000), next_cursor: 'file-0999' };
  }, 'recordings');
  expect(result.entries).toEqual(entries);
  expect(requests).toEqual([
    { path: 'recordings', page_size: 1000 },
    { path: 'recordings', page_size: 1000, cursor: 'file-0999' },
  ]);
});

test('old hosts use a narrow one-time legacy fallback', async () => {
  const requests: Record<string, unknown>[] = [];
  const result = await listNativeFiles(async (params) => {
    requests.push(params);
    if (params.page_size) throw new Error('Invalid filesystem request parameters.');
    return { entries: [] };
  });
  expect(result).toEqual({ entries: [] });
  expect(requests).toEqual([{ path: '', page_size: 1000 }, { path: '' }]);
  let calls = 0;
  await expect(
    listNativeFiles(async () => {
      calls++;
      throw new Error('Permission denied.');
    }),
  ).rejects.toThrow('Permission denied.');
  expect(calls).toBe(1);
});

test('invalid and repeated cursors terminate with an error', async () => {
  for (const next_cursor of ['repeated', 'mismatched']) {
    let calls = 0;
    await expect(
      listNativeFiles(async () => {
        calls++;
        return { entries: [{ name: 'repeated', kind: 'file', size_bytes: 1 }], next_cursor };
      }),
    ).rejects.toThrow('invalid directory cursor');
    expect(calls).toBe(next_cursor === 'repeated' ? 2 : 1);
  }
});
