import { describe, expect, test } from 'bun:test';
import type { LlmConfiguration, LlmRequest, LlmResult } from '@apell/sdk';
import { generateEventTitle, type TitleModel } from '../src/lib/event-title';

const config: LlmConfiguration = {
  connection_id: 'fixture',
  model_id: 'fixture-model',
  provider_id: 'fixture',
  provider_name: 'Test model',
  mode: 'provider',
  capabilities: {
    tools: 'unknown',
    required_tool_choice: 'unknown',
    exposed_reasoning: 'unknown',
    image_input: 'unknown',
    pdf_input: 'unknown',
    audio_input: 'unknown',
    image_output: 'unknown',
    audio_output: 'unknown',
  },
};
const input = {
  local_time: '2026-06-10T09:15',
  utc_offset_minutes: 120,
  location: { latitude: 12, longitude: 34 },
};

function response(request: LlmRequest, content = 'June morning'): LlmResult {
  return {
    request_id: request.request_id!,
    status: 'completed',
    content,
    message: { role: 'assistant', content },
    tool_calls: [],
    media: [],
    finish_reason: 'stop',
    provenance: { connection_id: 'fixture', requested_model_id: 'fixture-model', model_id: null },
    error: null,
  };
}

describe('photo event titles', () => {
  test('sends only validated time and coordinates, even when the caller supplies full draft and GPS objects', async () => {
    const controller = new AbortController();
    const draft = {
      ...input,
      location: { ...input.location, captured_at: 'private', address: 'private' },
      file_name: 'private.jpg',
      notes: 'private notes',
      photos: [{ path: 'images/private.jpg' }],
    };
    const llm: TitleModel = {
      config: async () => config,
      async generate(request, options) {
        expect(request.target).toEqual({
          connection_id: config.connection_id,
          model_id: config.model_id,
        });
        expect(request.stream).toBe(false);
        expect(options?.signal).toBe(controller.signal);
        expect(request.messages).toHaveLength(2);
        expect(request.messages[0]?.role).toBe('system');
        expect(request.messages[1]).toEqual({ role: 'user', content: JSON.stringify(input) });
        expect(JSON.stringify(request)).not.toContain('private');
        return response(request, '  June morning  ');
      },
    };
    expect(await generateEventTitle(llm, draft, controller.signal)).toBe('June morning');
  });

  test('keeps unknown time, offset, and location explicit', async () => {
    for (const partial of [
      { local_time: '', utc_offset_minutes: null, location: input.location },
      { local_time: input.local_time, utc_offset_minutes: null, location: null },
    ]) {
      const llm: TitleModel = {
        config: async () => config,
        async generate(request) {
          expect(JSON.parse(String(request.messages[1]?.content))).toEqual({
            ...partial,
            local_time: partial.local_time || null,
          });
          return response(request);
        },
      };
      await generateEventTitle(llm, partial, new AbortController().signal);
    }
  });

  test('rejects empty, invalid, and aborted inputs before model lookup', async () => {
    let lookups = 0;
    const llm: TitleModel = {
      async config() {
        lookups++;
        return config;
      },
      generate: async (request) => response(request),
    };
    const signal = new AbortController().signal;
    for (const invalid of [
      { ...input, local_time: '', location: null },
      { ...input, local_time: 'invalid' },
      { ...input, location: { latitude: NaN, longitude: 12 } },
      { ...input, utc_offset_minutes: 2000 },
    ]) {
      await expect(generateEventTitle(llm, invalid, signal)).rejects.toThrow();
    }
    await expect(generateEventTitle(llm, input, AbortSignal.abort())).rejects.toThrow();
    expect(lookups).toBe(0);
  });

  test('a demo connection does not generate a title', async () => {
    const llm: TitleModel = {
      config: async () => ({ ...config, mode: 'demo' }),
      generate: async () => {
        throw new Error('Unexpected title request');
      },
    };
    await expect(generateEventTitle(llm, input, new AbortController().signal)).rejects.toThrow(
      'Apell settings',
    );
  });

  test('rejects incomplete, misrouted, or malformed responses', async () => {
    const variants: Array<(request: LlmRequest) => LlmResult> = [
      (request) => ({ ...response(request), status: 'truncated' }),
      (request) => ({ ...response(request), request_id: 'different' }),
      (request) => response(request, ''),
      (request) => response(request, 'Title\nAnother title'),
      (request) => response(request, 'x'.repeat(201)),
    ];
    for (const variant of variants) {
      const llm: TitleModel = {
        config: async () => config,
        generate: async (request) => variant(request),
      };
      await expect(generateEventTitle(llm, input, new AbortController().signal)).rejects.toThrow();
    }
  });
});
