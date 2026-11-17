import type { LlmMessage, LlmProvenance, LlmSelection } from '@apell/sdk';
import type { KeyPoint, LearningMemory, LearningTurn, Topic } from './types';

export const DOMAIN_LIMITS = {
  title: 160,
  goal: 4_000,
  description: 2_000,
  summary: 8_000,
  message: 120_000,
  key_points: 32,
  turns: 2_000,
  topic_bytes: 8 * 1_024 * 1_024,
} as const;

export function createId(
  source: Pick<Crypto, 'getRandomValues'> &
    Partial<Pick<Crypto, 'randomUUID'>> = crypto,
): string {
  if (typeof source.randomUUID === 'function') return source.randomUUID();
  const bytes = source.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

export function isValidId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9-]{1,128}$/.test(value);
}

export function requireId(value: unknown): string {
  if (!isValidId(value)) throw new Error('Invalid saved identity.');
  return value;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value as Record<string, unknown>;
}

function string(
  value: unknown,
  label: string,
  limit: number,
  allow_empty = false,
): string {
  if (
    typeof value !== 'string' ||
    value.length > limit ||
    (!allow_empty && !value.trim())
  )
    throw new Error(`Invalid ${label}.`);
  return value;
}

function timestamp(value: unknown): string {
  const text = string(value, 'saved date', 40);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text) || !Number.isFinite(Date.parse(text))) {
    throw new Error('Invalid saved date.');
  }
  return text;
}

/** Reject values JSON would silently remove or alter before preserving provider metadata. */
function assertJson(
  value: unknown,
  ancestors = new Set<object>(),
  depth = 0,
): void {
  if (depth > 64) throw new Error('Saved data is nested too deeply.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || value === null || ancestors.has(value)) {
    throw new Error('Saved data must contain JSON values.');
  }
  const prototype = Object.getPrototypeOf(value);
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  ) {
    throw new Error('Saved data must contain plain JSON objects.');
  }
  if (Object.getOwnPropertySymbols(value).length)
    throw new Error('Invalid saved JSON fields.');
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (!(index in value))
        throw new Error('Saved data must not contain sparse JSON arrays.');
    }
  }
  ancestors.add(value);
  for (const entry of Object.values(value))
    assertJson(entry, ancestors, depth + 1);
  ancestors.delete(value);
}

function message(value: unknown, role: 'user' | 'assistant'): LlmMessage {
  const record = object(value, 'conversation message');
  if (record.role !== role)
    throw new Error('Invalid conversation message role.');
  // The entire message, including provider_state and future fields, is replayable.
  return record as LlmMessage;
}

function parseModel(value: unknown): LlmSelection | null {
  if (value === null) return null;
  const record = object(value, 'model selection');
  return {
    connection_id: string(record.connection_id, 'model connection', 512),
    model_id: string(record.model_id, 'model identity', 512),
    provider_id: string(record.provider_id, 'provider identity', 512),
    provider_name: string(record.provider_name, 'provider name', 512),
  };
}

function parseMemory(value: unknown): LearningMemory | null {
  if (value === null) return null;
  const record = object(value, 'learning memory');
  if (typeof record.learned !== 'boolean') {
    throw new Error('Invalid learned state.');
  }
  return {
    summary: string(record.summary, 'memory summary', DOMAIN_LIMITS.summary),
    learned: record.learned,
    updated_at: timestamp(record.updated_at),
    source_turn_id: requireId(record.source_turn_id),
  };
}

function parseProvenance(value: unknown): LlmProvenance {
  const record = object(value, 'model provenance');
  return {
    connection_id: string(record.connection_id, 'model connection', 512),
    requested_model_id: string(
      record.requested_model_id,
      'requested model identity',
      512,
    ),
    model_id:
      record.model_id === null
        ? null
        : string(record.model_id, 'reported model identity', 512),
  };
}

function parseTurn(value: unknown): LearningTurn {
  const record = object(value, 'conversation turn');
  return {
    id: requireId(record.id),
    created_at: timestamp(record.created_at),
    user_text: string(
      record.user_text,
      'learner message',
      DOMAIN_LIMITS.message,
    ),
    assistant_text: string(
      record.assistant_text,
      'guide message',
      DOMAIN_LIMITS.message,
    ),
    user_message: message(record.user_message, 'user'),
    assistant_message: message(record.assistant_message, 'assistant'),
    provenance: parseProvenance(record.provenance),
  };
}

function uniqueIds(values: { id: string }[], label: string): void {
  if (new Set(values.map((value) => value.id)).size !== values.length) {
    throw new Error(`Duplicate ${label} identity.`);
  }
}

function parsePoint(value: unknown): KeyPoint {
  const record = object(value, 'key point');
  if (
    !Array.isArray(record.turns) ||
    record.turns.length > DOMAIN_LIMITS.turns
  ) {
    throw new Error('Invalid saved conversation.');
  }
  const turns = record.turns.map(parseTurn);
  uniqueIds(turns, 'conversation turn');
  const memory = parseMemory(record.memory);
  if (memory && !turns.some((turn) => turn.id === memory.source_turn_id)) {
    throw new Error(
      'Learning memory does not match a saved conversation turn.',
    );
  }
  return {
    id: requireId(record.id),
    title: string(record.title, 'key point title', DOMAIN_LIMITS.title),
    description: string(
      record.description,
      'key point description',
      DOMAIN_LIMITS.description,
    ),
    turns,
    memory,
  };
}

export function parseTopic(value: unknown): Topic {
  assertJson(value);
  const encoded = JSON.stringify(value);
  if (
    new TextEncoder().encode(encoded).byteLength > DOMAIN_LIMITS.topic_bytes
  ) {
    throw new Error('This topic exceeds the 8 MiB storage limit.');
  }
  // Snapshot input so later UI changes cannot mutate a pending write or replay metadata.
  const record = object(JSON.parse(encoded), 'topic');
  if (record.schema_version !== 1)
    throw new Error('Unsupported saved topic version.');
  if (
    !Array.isArray(record.key_points) ||
    record.key_points.length > DOMAIN_LIMITS.key_points
  ) {
    throw new Error('Invalid saved key points.');
  }
  const key_points = record.key_points.map(parsePoint);
  uniqueIds(key_points, 'key point');
  const model = parseModel(record.model);
  if (!model && key_points.some((point) => point.turns.length)) {
    throw new Error(
      'Saved conversations require their original model selection.',
    );
  }
  if (
    model &&
    key_points.some((point) =>
      point.turns.some(
        (turn) =>
          turn.provenance.connection_id !== model.connection_id ||
          turn.provenance.requested_model_id !== model.model_id,
      ),
    )
  )
    throw new Error('Saved conversation does not match its model selection.');
  return {
    schema_version: 1,
    id: requireId(record.id),
    title: string(record.title, 'topic title', DOMAIN_LIMITS.title),
    goal: string(record.goal, 'learning goal', DOMAIN_LIMITS.goal, true),
    model,
    key_points,
    created_at: timestamp(record.created_at),
    updated_at: timestamp(record.updated_at),
  };
}

export function createTopic(title: string, goal = ''): Topic {
  const now = new Date().toISOString();
  return parseTopic({
    schema_version: 1,
    id: createId(),
    title: title.trim(),
    goal: goal.trim(),
    model: null,
    key_points: [],
    created_at: now,
    updated_at: now,
  });
}

export function learnedCount(topic: Topic): number {
  return topic.key_points.filter((point) => point.memory?.learned === true)
    .length;
}

/** A stale memory remains useful while the latest completed exchange is reviewed. */
export function needsMemoryUpdate(point: KeyPoint): boolean {
  const latest = point.turns.at(-1);
  return Boolean(latest && point.memory?.source_turn_id !== latest.id);
}
