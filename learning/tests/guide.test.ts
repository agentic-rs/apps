import { describe, expect, test } from 'bun:test';
import type {
  LlmConfiguration,
  LlmGenerateOptions,
  LlmMessage,
  LlmRequest,
  LlmResult,
  LlmSelection,
  LlmStatus,
} from '@apell/sdk';
import {
  createNativeGuide,
  createUnavailableGuide,
  GuideError,
} from '../src/lib/guide';
import { createTopic } from '../src/lib/model';
import type {
  GenerationOptions,
  KeyPoint,
  LearningTurn,
  Topic,
} from '../src/lib/types';

const model: LlmSelection = {
  connection_id: 'test-connection',
  model_id: 'test-model',
  provider_id: 'test-provider',
  provider_name: 'Test provider',
};
const configuration: LlmConfiguration = {
  ...model,
  mode: 'provider',
  capabilities: {
    tools: 'unknown',
    required_tool_choice: 'unknown',
    exposed_reasoning: 'unknown',
    image_input: 'unknown',
    pdf_input: 'unknown',
    audio_input: 'unknown',
  },
};
const plan_text = JSON.stringify({
  key_points: [
    { title: 'Foundation', description: 'Understand the basic idea.' },
    { title: 'Mechanism', description: 'Explain how it works.' },
    {
      title: 'Application',
      description: 'Use the idea in a concrete example.',
    },
    {
      title: 'Limitations',
      description: 'Identify when the idea does not apply.',
    },
  ],
});

function options(): GenerationOptions {
  return { signal: new AbortController().signal };
}

function topicFixture(): Topic {
  return {
    ...createTopic('Learning topic', 'Understand the fundamentals'),
    model: { ...model },
  };
}

function pointFixture(): KeyPoint {
  return {
    id: crypto.randomUUID(),
    title: 'Foundation',
    description: 'Understand the basic idea.',
    turns: [],
    memory: null,
  };
}

function turnFixture(text = 'A useful explanation.'): LearningTurn {
  return {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    user_text: 'Explain the foundation.',
    assistant_text: text,
    user_message: { role: 'user', content: 'Explain the foundation.' },
    assistant_message: {
      role: 'assistant',
      content: text,
      provider_state: {
        protocol: 'test-protocol',
        output: [{ encrypted_reasoning: 'opaque-data' }],
      },
      future_metadata: { preserved: true },
    },
    provenance: {
      connection_id: model.connection_id,
      requested_model_id: model.model_id,
      model_id: null,
    },
  };
}

function completed(
  request: LlmRequest,
  content = 'A useful explanation.',
): LlmResult {
  return {
    request_id: request.request_id!,
    content,
    tool_calls: [],
    message: { role: 'assistant', content },
    status: 'completed',
    finish_reason: 'stop',
    provenance: {
      connection_id: model.connection_id,
      requested_model_id: model.model_id,
      model_id: 'reported-model-version',
    },
    error: null,
  };
}

function setup(
  respond: (
    request: LlmRequest,
    opts?: LlmGenerateOptions,
  ) => LlmResult | Promise<LlmResult> = (request) => completed(request),
) {
  const requests: LlmRequest[] = [];
  const calls: { method: string; value: unknown }[] = [];
  const llm = {
    async chooseModel(value = {}) {
      calls.push({ method: 'choose', value });
      return model;
    },
    async config(value?: unknown) {
      calls.push({ method: 'config', value });
      return configuration;
    },
    async generate(request: LlmRequest, opts?: LlmGenerateOptions) {
      requests.push(request);
      return respond(request, opts);
    },
  };
  return { guide: createNativeGuide(llm), llm, requests, calls };
}

describe('learning guide', () => {
  test('uses the host picker and validates the configured provider', async () => {
    const { guide, calls } = setup();
    expect(await guide.chooseModel(model)).toEqual(model);
    expect(calls).toEqual([
      { method: 'choose', value: { current: model } },
      { method: 'config', value: model },
    ]);
    const { llm } = setup();
    expect(
      await createNativeGuide({
        ...llm,
        chooseModel: async () => null,
      }).chooseModel(),
    ).toBeNull();
    await expect(
      createNativeGuide({
        ...llm,
        config: async () => ({ ...configuration, mode: 'demo' }),
      }).chooseModel(),
    ).rejects.toMatchObject({ code: 'invalid_model' });
  });

  test('generates validated key points from fenced JSON using the selected route', async () => {
    const { guide, requests } = setup((request) =>
      completed(request, `\`\`\`json\n${plan_text}\n\`\`\``),
    );
    const topic = topicFixture();
    const points = await guide.plan(topic, options());
    expect(points).toHaveLength(4);
    expect(new Set(points.map((point) => point.id)).size).toBe(4);
    expect(
      points.every(
        (point) => point.turns.length === 0 && point.memory === null,
      ),
    ).toBe(true);
    expect(requests[0]!.target).toEqual({
      connection_id: model.connection_id,
      model_id: model.model_id,
    });
    expect(requests[0]!.max_output_tokens).toBeUndefined();
    expect(topic.key_points).toEqual([]);
  });

  test('rejects malformed, incomplete, oversized, and duplicate learning paths', async () => {
    for (const content of [
      'Here is your path: ' + plan_text,
      '{"key_points":',
      JSON.stringify({
        key_points: [{ title: 'Only one', description: 'Too short' }],
      }),
      JSON.stringify({
        key_points: Array.from({ length: 4 }, () => ({
          title: 'Repeated',
          description: 'The same point.',
        })),
      }),
      JSON.stringify({
        key_points: Array.from({ length: 4 }, (_, index) => ({
          title: String(index),
          description: '',
        })),
      }),
      JSON.stringify({
        key_points: Array.from({ length: 4 }, (_, index) => ({
          title: String(index).repeat(161),
          description: 'Too long',
        })),
      }),
    ]) {
      const { guide } = setup((request) => completed(request, content));
      await expect(guide.plan(topicFixture(), options())).rejects.toMatchObject(
        {
          code: 'invalid_plan',
        },
      );
    }
  });

  test('keeps a populated path and its model binding intact', async () => {
    const { guide, requests } = setup();
    const topic = topicFixture();
    const point = pointFixture();
    topic.key_points.push(point);
    await expect(guide.plan(topic, options())).rejects.toMatchObject({
      code: 'already_planned',
    });
    point.turns.push(turnFixture());
    topic.model = { ...model, connection_id: 'different-connection' };
    await expect(
      guide.explore(topic, point, 'Continue', options()),
    ).rejects.toMatchObject({
      code: 'model_mismatch',
    });
    expect(requests).toEqual([]);
  });

  test('replays exact messages, preserves new provider metadata, and includes only current-topic memories', async () => {
    const response_message: LlmMessage = {
      role: 'assistant',
      content: 'New explanation.',
      provider_state: { opaque_output: 'keep-this-exactly' },
      reasoning_content: 'Provider replay metadata.',
    };
    const { guide, requests } = setup((request) => ({
      ...completed(request, 'New explanation.'),
      message: response_message,
    }));
    const topic = topicFixture();
    const point = pointFixture();
    const previous = turnFixture();
    point.turns.push(previous);
    const learned = {
      ...pointFixture(),
      title: 'Another learned point',
      memory: {
        summary: 'Remember this insight.',
        learned: true,
        updated_at: new Date().toISOString(),
        source_turn_id: previous.id,
      },
    };
    const other_point = pointFixture();
    other_point.turns.push(turnFixture('Unrelated point conversation.'));
    topic.key_points.push(point, learned, other_point);
    const turn = await guide.explore(
      topic,
      point,
      '  Show an example.  ',
      options(),
    );
    const messages = requests[0]!.messages;
    expect(messages[1]).toBe(previous.user_message);
    expect(messages[2]).toBe(previous.assistant_message);
    expect(messages).toHaveLength(4);
    expect(JSON.stringify(messages)).not.toContain(
      'Unrelated point conversation.',
    );
    const latest = JSON.parse(messages[3]!.content as string);
    expect(latest.question).toBe('Show an example.');
    expect(latest.learning_memories).toEqual([
      {
        key_point: learned.title,
        summary: learned.memory.summary,
        learned: true,
        updated_at: learned.memory.updated_at,
      },
    ]);
    expect(turn.assistant_message).toBe(response_message);
    expect(turn.user_message).toBe(messages[3]!);
    expect(turn.provenance.model_id).toBe('reported-model-version');
    expect(point.turns).toEqual([previous]);
  });

  test('assesses actual learner exchanges and prior memory without assuming explanation proves understanding', async () => {
    const { guide, requests } = setup((request) =>
      completed(
        request,
        JSON.stringify({
          summary:
            'The guide explained the basic idea; revisit the edge cases.',
          learned: false,
        }),
      ),
    );
    const topic = topicFixture();
    const point = pointFixture();
    point.turns.push(turnFixture());
    point.memory = {
      summary: 'An earlier insight.',
      learned: false,
      updated_at: new Date().toISOString(),
      source_turn_id: point.turns[0]!.id,
    };
    topic.key_points.push(point);
    const before = JSON.stringify(topic);
    const memory = await guide.summarize(topic, point, options());
    const context = JSON.parse(requests[0]!.messages[1]!.content as string);
    expect(context.exchanges).toEqual([
      {
        learner: point.turns[0]!.user_text,
        guide: point.turns[0]!.assistant_text,
      },
    ]);
    expect(context.prior_memory).toEqual(point.memory);
    expect(memory.summary).toContain('revisit');
    expect(memory.learned).toBe(false);
    expect(memory.source_turn_id).toBe(point.turns.at(-1)!.id);
    expect(Number.isFinite(Date.parse(memory.updated_at))).toBe(true);
    expect(requests[0]!.messages[0]!.content).toContain('An AI explanation');
    expect(JSON.stringify(topic)).toBe(before);
  });

  test('accepts fenced memory assessments and assigns local timestamps and source identity', async () => {
    const topic = topicFixture();
    const point = pointFixture();
    point.turns.push(turnFixture(), {
      ...turnFixture(),
      user_text: 'I understand: doubling the weight doubles its contribution.',
    });
    topic.key_points.push(point);
    const { guide } = setup((request) =>
      completed(
        request,
        '```json\n' +
          JSON.stringify({
            summary: 'The learner correctly explained proportional weighting.',
            learned: true,
            source_turn_id: 'invented-by-model',
            updated_at: 'invented-by-model',
          }) +
          '\n```',
      ),
    );
    const memory = await guide.summarize(topic, point, options());
    expect(memory.learned).toBe(true);
    expect(memory.source_turn_id).toBe(point.turns.at(-1)!.id);
    expect(Number.isFinite(Date.parse(memory.updated_at))).toBe(true);
    expect(point.memory).toBeNull();
  });

  test('rejects malformed memory assessments instead of silently recording completion', async () => {
    const topic = topicFixture();
    const point = pointFixture();
    point.turns.push(turnFixture());
    topic.key_points.push(point);
    for (const content of [
      'The learner understood everything.',
      JSON.stringify({ summary: 'A summary without an assessment.' }),
      JSON.stringify({ summary: 'An ambiguous assessment.', learned: 'yes' }),
      JSON.stringify({ summary: ' ', learned: true }),
      JSON.stringify({ summary: 'x'.repeat(8001), learned: false }),
      'null',
    ]) {
      const { guide } = setup((request) => completed(request, content));
      await expect(
        guide.summarize(topic, point, options()),
      ).rejects.toMatchObject({
        code: 'invalid_memory',
      });
      expect(point.memory).toBeNull();
    }
  });

  test('rejects empty conversations, absent models, and points from other topics', async () => {
    const { guide, requests } = setup();
    const topic = topicFixture();
    const point = pointFixture();
    topic.key_points.push(point);
    await expect(
      guide.summarize(topic, point, options()),
    ).rejects.toMatchObject({
      code: 'no_conversation',
    });
    await expect(
      guide.explore(topic, pointFixture(), 'Question', options()),
    ).rejects.toMatchObject({ code: 'invalid_point' });
    await expect(
      guide.explore(topic, point, '   ', options()),
    ).rejects.toMatchObject({
      code: 'invalid_question',
    });
    topic.model = null;
    await expect(
      guide.explore(topic, point, 'Question', options()),
    ).rejects.toMatchObject({
      code: 'missing_model',
    });
    expect(requests).toEqual([]);
  });

  test('does not accept interrupted, failed, unsupported, or tool-call output as completed learning', async () => {
    const statuses: LlmStatus[] = [
      'cancelled',
      'truncated',
      'failed',
      'unsupported',
      'tool_calls',
    ];
    for (const status of statuses) {
      const { guide } = setup((request) => ({
        ...completed(request, 'Partial answer.'),
        status,
        message: null,
      }));
      await expect(guide.plan(topicFixture(), options())).rejects.toMatchObject(
        {
          code: status,
          partial_content: 'Partial answer.',
        },
      );
    }
  });

  test('rejects mismatched attribution, missing replay messages, and differing projected text', async () => {
    const mutations: ((result: LlmResult) => LlmResult)[] = [
      (result) => ({ ...result, request_id: 'different-request' }),
      (result) => ({
        ...result,
        provenance: {
          ...result.provenance,
          connection_id: 'different-connection',
        },
      }),
      (result) => ({
        ...result,
        provenance: {
          ...result.provenance,
          requested_model_id: 'different-model',
        },
      }),
      (result) => ({ ...result, message: null }),
      (result) => ({
        ...result,
        message: { role: 'assistant', content: 'Different answer.' },
      }),
    ];
    for (const mutate of mutations) {
      const { guide } = setup((request) =>
        mutate(completed(request, plan_text)),
      );
      await expect(
        guide.plan(topicFixture(), options()),
      ).rejects.toBeInstanceOf(GuideError);
    }
  });

  test('streams accumulated answer text without exposing reasoning or unrelated request events', async () => {
    const streamed: string[] = [];
    const { guide } = setup((request, opts) => {
      opts?.on_event?.({
        request_id: 'unrelated',
        kind: 'text_delta',
        text: 'Wrong request',
      });
      opts?.on_event?.({
        request_id: request.request_id!,
        kind: 'reasoning_delta',
        text: 'Hidden reasoning',
      });
      opts?.on_event?.({
        request_id: request.request_id!,
        kind: 'text_delta',
        text: 'First',
      });
      opts?.on_event?.({
        request_id: request.request_id!,
        kind: 'text_delta',
        text: ' second',
      });
      return completed(request, 'First second');
    });
    const topic = topicFixture();
    const point = pointFixture();
    topic.key_points.push(point);
    await guide.explore(topic, point, 'Question', {
      ...options(),
      on_text: (text) => streamed.push(text),
    });
    expect(streamed).toEqual(['First', 'First second']);
  });

  test('does not start an already cancelled request and rejects late success after cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const first = setup();
    await expect(
      first.guide.plan(topicFixture(), { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(first.requests).toEqual([]);
    const active = new AbortController();
    const second = setup((request, opts) => {
      expect(opts?.signal).toBe(active.signal);
      active.abort();
      return completed(request, plan_text);
    });
    await expect(
      second.guide.plan(topicFixture(), { signal: active.signal }),
    ).rejects.toMatchObject({ code: 'cancelled' });
  });

  test('preserves partial answer text on bridge failures', async () => {
    const { guide } = setup(async () => {
      throw Object.assign(new Error('Connection lost.'), {
        partial_content: 'Partial explanation.',
      });
    });
    await expect(guide.plan(topicFixture(), options())).rejects.toMatchObject({
      code: 'connection_failed',
      partial_content: 'Partial explanation.',
    });
  });

  test('rejects oversized context without dropping previous provider history', async () => {
    const { guide, requests } = setup();
    const topic = topicFixture();
    const point = pointFixture();
    point.turns = Array.from({ length: 128 }, () => turnFixture());
    topic.key_points.push(point);
    await expect(
      guide.explore(topic, point, 'Question', options()),
    ).rejects.toMatchObject({
      code: 'context_limit',
    });
    expect(point.turns).toHaveLength(128);
    point.turns = [turnFixture()];
    point.turns[0]!.assistant_message.provider_state = {
      data: '学'.repeat(180_000),
    };
    await expect(
      guide.explore(topic, point, 'Question', options()),
    ).rejects.toMatchObject({
      code: 'context_limit',
    });
    expect(requests).toEqual([]);
    expect(
      (point.turns[0]!.assistant_message.provider_state as { data: string })
        .data.length,
    ).toBe(180_000);
  });

  test('browser mode never substitutes fabricated AI results', async () => {
    const guide = createUnavailableGuide();
    expect(guide.available).toBe(false);
    await expect(guide.chooseModel()).rejects.toMatchObject({
      code: 'unavailable',
    });
    await expect(guide.plan(topicFixture(), options())).rejects.toMatchObject({
      code: 'unavailable',
    });
  });
});
