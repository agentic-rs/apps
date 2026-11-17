import { expect, test } from 'bun:test';
import { createId } from '../src/lib/identity';

test('uses the native UUID API when available', () => {
  const expected = '12345678-1234-4123-8123-123456789012';
  expect(
    createId({
      randomUUID: () => expected,
      getRandomValues: () => {
        throw new Error('The fallback should not be called.');
      },
    }),
  ).toBe(expected);
});

test('fallback preserves random bytes while setting UUID version and variant bits', () => {
  const id = createId({
    getRandomValues(bytes) {
      bytes.set(Array.from({ length: 16 }, (_, index) => index));
      return bytes;
    },
  });
  expect(id).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
  expect(createId({ getRandomValues: (bytes) => bytes.fill(255) })).toBe(
    'ffffffff-ffff-4fff-bfff-ffffffffffff',
  );
});

test('fallback generates distinct IDs from cryptographic random bytes', () => {
  const ids = Array.from({ length: 1_000 }, () =>
    createId({
      getRandomValues: (bytes) => crypto.getRandomValues(bytes),
    }),
  );
  expect(new Set(ids).size).toBe(ids.length);
  expect(
    ids.every((id) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id),
    ),
  ).toBe(true);
});
