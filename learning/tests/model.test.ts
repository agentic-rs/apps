import { describe, expect, test } from 'bun:test';
import {
  createId,
  createTopic,
  DOMAIN_LIMITS,
  isValidId,
  learnedCount,
  needsMemoryUpdate,
  parseTopic,
} from '../src/lib/model';
import { savedTopic } from './storage-fixtures';

describe('learning data boundaries', () => {
  test('creates safe identities when a WebView does not expose randomUUID', () => {
    const source = { getRandomValues: crypto.getRandomValues.bind(crypto) };
    const ids = Array.from({ length: 100 }, () => createId(source));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => isValidId(id) && id.length === 32)).toBe(true);
  });

  test('creates a blank topic without implying understanding', () => {
    const topic = createTopic('  Trees  ', '  Understand growth  ');
    expect(topic.title).toBe('Trees');
    expect(topic.goal).toBe('Understand growth');
    expect(topic.model).toBeNull();
    expect(topic.key_points).toEqual([]);
    expect(learnedCount(topic)).toBe(0);
    expect(() => createTopic(' ')).toThrow('title');
    expect(() => createTopic('t'.repeat(DOMAIN_LIMITS.title + 1))).toThrow(
      'title',
    );
  });

  test('keeps replay metadata intact and detached from callers', () => {
    const topic = savedTopic();
    const parsed = parseTopic(topic);
    expect(parsed).toEqual(topic);
    topic.key_points[0]!.turns[0]!.assistant_message.provider_state = null;
    expect(
      parsed.key_points[0]!.turns[0]!.assistant_message.provider_state,
    ).not.toBeNull();
    expect(learnedCount(parsed)).toBe(1);
  });

  test('tracks automatic memory separately from demonstrated learning', () => {
    const topic = savedTopic();
    const point = topic.key_points[0]!;
    expect(needsMemoryUpdate(point)).toBe(false);
    point.memory!.learned = false;
    expect(learnedCount(parseTopic(topic))).toBe(0);
    expect(needsMemoryUpdate(point)).toBe(false);
    point.memory = null;
    expect(needsMemoryUpdate(point)).toBe(true);
    point.turns = [];
    expect(needsMemoryUpdate(point)).toBe(false);
  });

  test('retains historical learning while a newer turn awaits memory refresh', () => {
    const topic = savedTopic();
    const point = topic.key_points[0]!;
    point.turns.push({ ...point.turns[0]!, id: 'turn-two' });
    const saved = parseTopic(topic);
    expect(needsMemoryUpdate(saved.key_points[0]!)).toBe(true);
    expect(learnedCount(saved)).toBe(1);
    point.memory!.source_turn_id = 'turn-two';
    expect(needsMemoryUpdate(parseTopic(topic).key_points[0]!)).toBe(false);
  });

  test('rejects memories without a valid learned state and source turn', () => {
    const topic = savedTopic();
    const point = topic.key_points[0]!;
    expect(() =>
      parseTopic({
        ...topic,
        key_points: [
          { ...point, memory: { ...point.memory, learned: 'true' } },
        ],
      }),
    ).toThrow('learned state');
    expect(() =>
      parseTopic({
        ...topic,
        key_points: [
          {
            ...point,
            memory: { ...point.memory, source_turn_id: 'missing-turn' },
          },
        ],
      }),
    ).toThrow('saved conversation turn');
    expect(() =>
      parseTopic({
        ...topic,
        key_points: [
          { ...point, memory: { ...point.memory, updated_at: 'yesterday' } },
        ],
      }),
    ).toThrow('date');
  });

  test('rejects schema, identity, role, duplicate and model corruption', () => {
    const topic = savedTopic();
    expect(() => parseTopic({ ...topic, schema_version: 2 })).toThrow(
      'version',
    );
    expect(() => parseTopic({ ...topic, id: '../elsewhere' })).toThrow(
      'identity',
    );
    expect(() => parseTopic({ ...topic, created_at: 'yesterday' })).toThrow(
      'date',
    );
    expect(() =>
      parseTopic({
        ...topic,
        key_points: [topic.key_points[0], topic.key_points[0]],
      }),
    ).toThrow('Duplicate');
    expect(() => parseTopic({ ...topic, model: null })).toThrow(
      'original model',
    );
    expect(() =>
      parseTopic({
        ...topic,
        model: { ...topic.model, model_id: 'another-model' },
      }),
    ).toThrow('does not match');
    const point = topic.key_points[0]!;
    expect(() =>
      parseTopic({
        ...topic,
        key_points: [{ ...point, turns: [point.turns[0], point.turns[0]] }],
      }),
    ).toThrow('Duplicate');
    point.turns[0]!.assistant_message.role = 'user';
    expect(() => parseTopic(topic)).toThrow('role');
  });

  test('rejects values that JSON would silently lose or alter', () => {
    const topic = savedTopic();
    topic.key_points[0]!.turns[0]!.assistant_message.provider_state =
      Number.NaN;
    expect(() => parseTopic(topic)).toThrow('JSON');
    expect(() => parseTopic({ ...topic, unsupported: undefined })).toThrow(
      'JSON',
    );
    expect(() =>
      parseTopic({ ...createTopic('Trees'), goal: new Date() }),
    ).toThrow('plain JSON');
  });

  test('bounds UTF-8 storage bytes, not just string length', () => {
    const topic = savedTopic();
    topic.key_points[0]!.turns[0]!.assistant_message.provider_state =
      '🌱'.repeat(DOMAIN_LIMITS.topic_bytes / 4);
    expect(() => parseTopic(topic)).toThrow('8 MiB');
  });
});
