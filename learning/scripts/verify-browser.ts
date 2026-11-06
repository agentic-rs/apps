import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const playwright_module = process.env.PLAYWRIGHT_MODULE;
if (!playwright_module)
  throw new Error(
    'Set PLAYWRIGHT_MODULE to an installed playwright-core entrypoint.',
  );
const { firefox } = await import(playwright_module);
const project_root = fileURLToPath(new URL('..', import.meta.url));
const static_root = resolve(
  process.env.LEARNING_DIST ?? resolve(project_root, 'dist'),
);
const output_root = resolve(
  process.env.LEARNING_QA_OUTPUT ??
    resolve(project_root, 'artifacts/browser-check'),
);
await mkdir(output_root, { recursive: true });
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname === '/host') {
    response.setHeader('Content-Type', 'text/html');
    response.end(
      '<!doctype html><html><head><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}</style></head><body><iframe id="applet" sandbox="allow-scripts"></iframe></body></html>',
    );
    return;
  }
  try {
    const path = resolve(
      static_root,
      '.' + (url.pathname === '/' ? '/index.html' : url.pathname),
    );
    if (!path.startsWith(static_root + '/')) throw new Error('Invalid path');
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    response.setHeader(
      'Content-Type',
      (
        {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.css': 'text/css',
        } as Record<string, string>
      )[extname(path)] ?? 'application/octet-stream',
    );
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' ${origin}; style-src 'unsafe-inline' ${origin}; img-src data: blob: ${origin}; font-src ${origin}; connect-src ${origin}; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`,
    );
    response.end(await readFile(path));
  } catch {
    response.statusCode = 404;
    response.end('Missing');
  }
});
await new Promise<void>((done, fail) => {
  server.once('error', fail);
  server.listen(0, '127.0.0.1', done);
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
let browser: any;
const errors: string[] = [];
const checks: string[] = [];
let test_page: any;
const check = (name: string) => {
  checks.push(name);
  console.log('PASS', name);
};
try {
  browser = await firefox.launch({
    headless: true,
    ...(process.env.FIREFOX_BIN
      ? { executablePath: process.env.FIREFOX_BIN }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.addInitScript(() => {
    if (window.parent !== window)
      Object.defineProperty(crypto, 'randomUUID', { value: undefined });
  });
  const page = await context.newPage();
  test_page = page;
  page.setDefaultTimeout(10_000);
  page.on('pageerror', (error: Error) => errors.push(error.message));
  page.on('dialog', async (dialog: { accept(): Promise<void> }) =>
    dialog.accept(),
  );
  await page.goto(base + '/host');
  await page.evaluate((base: string) => {
    const state = {
      files: new Map<string, number[]>(),
      directories: new Set(['']),
      calls: [] as any[],
      generations: [] as any[],
      pending: new Map<string, () => void>(),
      next_response: 'completed',
      fail_next_memory: false,
      fail_next_memory_write: false,
      fail_next_write: false,
      exploration_count: 0,
      ready_count: 0,
    };
    (window as any).__learning_test = state;
    const model = {
      connection_id: 'test-connection',
      model_id: 'test-model',
      provider_id: 'test-provider',
      provider_name: 'Test provider',
    };
    const plan = {
      key_points: [
        {
          title: 'How neurons connect',
          description: 'Understand how a weighted connection carries a signal.',
        },
        {
          title: 'Learning from mistakes',
          description: 'Explain how prediction errors guide an update.',
        },
        {
          title: 'Putting layers together',
          description: 'Connect simple layers into a useful model.',
        },
        {
          title: 'Checking what generalizes',
          description:
            'Distinguish memorizing examples from learning patterns.',
        },
      ],
    };
    window.addEventListener('message', (event) => {
      const iframe = document.getElementById('applet') as HTMLIFrameElement;
      if (
        event.source !== iframe.contentWindow ||
        event.data?.type !== 'apell:ready'
      )
        return;
      state.ready_count++;
      const channel = new MessageChannel();
      channel.port1.onmessage = (event) => {
        const { request_id, method, params } = event.data;
        state.calls.push(event.data);
        const respond = (result: unknown) =>
          channel.port1.postMessage({ type: 'response', request_id, result });
        try {
          if (method === 'fs.mkdir') {
            let part = '';
            for (const name of params.path.split('/')) {
              part = part ? `${part}/${name}` : name;
              state.directories.add(part);
            }
            respond(null);
          } else if (method === 'fs.list') {
            if (!state.directories.has(params.path))
              throw new Error('Missing directory');
            const prefix = params.path ? params.path + '/' : '';
            const entry = (path: string) =>
              path.startsWith(prefix) &&
              path !== params.path &&
              !path.slice(prefix.length).includes('/');
            respond({
              entries: [
                ...[...state.directories].filter(entry).map((path) => ({
                  name: path.slice(prefix.length),
                  kind: 'directory',
                  size_bytes: 0,
                })),
                ...[...state.files]
                  .filter(([path]) => entry(path))
                  .map(([path, bytes]) => ({
                    name: path.slice(prefix.length),
                    kind: 'file',
                    size_bytes: bytes.length,
                  })),
              ],
            });
          } else if (method === 'fs.write') {
            if (state.fail_next_write) {
              state.fail_next_write = false;
              throw new Error('Simulated disk failure.');
            }
            state.files.set(params.path, params.bytes);
            respond({ size_bytes: params.bytes.length });
          } else if (method === 'fs.read') {
            const bytes = state.files.get(params.path);
            if (!bytes) throw new Error('Missing file');
            const offset = params.offset ?? 0;
            const length = params.length ?? 65_536;
            respond({
              bytes: bytes.slice(offset, offset + length),
              eof: offset + length >= bytes.length,
            });
          } else if (method === 'fs.remove') {
            if (!state.files.delete(params.path))
              throw new Error('Missing file');
            respond(null);
          } else if (method === 'llm.choose_model') respond(model);
          else if (method === 'llm.config')
            respond({
              ...model,
              mode: 'provider',
              capabilities: {
                tools: 'unknown',
                required_tool_choice: 'unknown',
                exposed_reasoning: 'unknown',
              },
            });
          else if (method === 'llm.cancel') {
            state.pending.get(params.request_id)?.();
            state.pending.delete(params.request_id);
            respond(null);
          } else if (method === 'llm.generate') {
            state.generations.push(params);
            const instruction = params.messages[0].content;
            const mode = state.next_response;
            state.next_response = 'completed';
            const is_plan = instruction.includes(
              'Create a focused learning path',
            );
            const is_summary = instruction.includes(
              'You maintain a learning memory',
            );
            let content: string;
            if (is_plan) content = JSON.stringify(plan);
            else if (is_summary) {
              const context = JSON.parse(params.messages.at(-1).content);
              const learned = context.exchanges.some(
                (exchange: { learner: string }) =>
                  exchange.learner.includes('I understand'),
              );
              content = JSON.stringify({
                summary: learned
                  ? 'The learner explained how a weight scales its input contribution. Next revisit learning from errors.'
                  : 'Covered weighted connections. Understanding is still being explored; practice an example.',
                learned,
              });
            } else {
              state.exploration_count++;
              content = `Guide answer ${state.exploration_count}: A weighted connection scales an input. Try explaining what changes when the weight doubles.`;
            }
            const provenance = {
              connection_id: model.connection_id,
              requested_model_id: model.model_id,
              model_id: 'test-model-version',
            };
            const result = {
              request_id: params.request_id,
              content,
              tool_calls: [],
              status: 'completed',
              finish_reason: 'stop',
              provenance,
              error: null,
              message: {
                role: 'assistant',
                content,
                provider_state: {
                  protocol: 'fixture',
                  output: [
                    { opaque_token: `preserve-${state.generations.length}` },
                  ],
                },
              },
            };
            if (mode === 'cancelled') {
              channel.port1.postMessage({
                type: 'event',
                event: {
                  request_id: params.request_id,
                  kind: 'text_delta',
                  text: 'An unfinished thought.',
                },
              });
              state.pending.set(params.request_id, () =>
                respond({
                  ...result,
                  content: 'An unfinished thought.',
                  message: null,
                  status: 'cancelled',
                  finish_reason: null,
                }),
              );
            } else if (
              mode === 'failed' ||
              (is_summary && state.fail_next_memory)
            ) {
              state.fail_next_memory = false;
              respond({
                ...result,
                content: 'A partial response.',
                message: null,
                status: 'failed',
                error: {
                  code: 'test_failure',
                  message: 'Simulated model failure.',
                  retryable: true,
                },
              });
            } else {
              if (is_summary && state.fail_next_memory_write) {
                state.fail_next_memory_write = false;
                state.fail_next_write = true;
              }
              if (!is_plan && !is_summary) {
                channel.port1.postMessage({
                  type: 'event',
                  event: {
                    request_id: params.request_id,
                    kind: 'text_delta',
                    text: content.slice(0, 30),
                  },
                });
                channel.port1.postMessage({
                  type: 'event',
                  event: {
                    request_id: params.request_id,
                    kind: 'text_delta',
                    text: content.slice(30),
                  },
                });
              }
              respond(result);
            }
          } else throw new Error(`Unexpected host method ${method}`);
        } catch (error) {
          channel.port1.postMessage({
            type: 'response',
            request_id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      };
      channel.port1.start();
      iframe.contentWindow!.postMessage({ type: 'apell:init' }, '*', [
        channel.port2,
      ]);
    });
    (document.getElementById('applet') as HTMLIFrameElement).src =
      base + '/index.html';
  }, base);
  const frame = page.frameLocator('#applet');
  await frame
    .getByRole('heading', { name: 'What would you like to learn?' })
    .waitFor();
  const native_frame = page
    .frames()
    .find((candidate: { url(): string }) =>
      candidate.url().endsWith('/index.html'),
    );
  assert.equal(await native_frame.evaluate(() => self.origin), 'null');
  assert.equal(
    await native_frame.evaluate(() => typeof crypto.randomUUID),
    'undefined',
  );
  await page.screenshot({ path: resolve(output_root, 'welcome-desktop.png') });
  check(
    'production app boots in an opaque iframe with the native bridge and restrictive CSP',
  );
  await frame
    .getByLabel('Your topic', { exact: true })
    .fill('How neural networks learn');
  await frame
    .getByLabel('What would you like to understand?', { exact: false })
    .fill('Understand the foundations and explain them in my own words.');
  await frame
    .getByRole('button', { name: 'Create topic', exact: true })
    .click();
  await frame
    .getByRole('button', { name: 'Choose model', exact: true })
    .click();
  await frame
    .getByRole('button', { name: 'test-model', exact: true })
    .waitFor();
  await frame
    .getByRole('button', { name: 'Generate key points', exact: true })
    .click();
  await frame.getByRole('button', { name: /01 How neurons connect/ }).waitFor();
  const readTopics = () =>
    page.evaluate(() =>
      [...(window as any).__learning_test.files.values()].map(
        (bytes: number[]) =>
          JSON.parse(new TextDecoder().decode(new Uint8Array(bytes))),
      ),
    );
  let saved = (await readTopics())[0];
  assert.equal(saved.key_points.length, 4);
  assert.equal(saved.model.model_id, 'test-model');
  assert.match(saved.id, /^[0-9a-f-]+$/);
  assert.equal(
    await frame
      .getByRole('button', { name: 'test-model', exact: true })
      .isDisabled(),
    true,
  );
  check(
    'create topic, choose model, generate and persist four key points with model locked',
  );
  const ask = async (question: string) => {
    await frame.getByLabel('Your question', { exact: true }).fill(question);
    await frame
      .getByRole('button', { name: 'Send question', exact: true })
      .click();
    await frame.getByRole('status').waitFor({ state: 'hidden' });
  };
  await ask('What is a weight?');
  await frame.getByText('Guide answer 1:', { exact: false }).waitFor();
  saved = (await readTopics())[0];
  assert.equal(saved.key_points[0].memory.learned, false);
  assert.equal(
    saved.key_points[0].memory.source_turn_id,
    saved.key_points[0].turns[0].id,
  );
  assert.equal(
    await frame.getByRole('progressbar').getAttribute('aria-valuenow'),
    '0',
  );
  check(
    'the first exchange automatically saves memory without treating an explanation as learned',
  );
  const first_message = saved.key_points[0].turns[0].assistant_message;
  await ask(
    'I understand: doubling the weight doubles its input contribution.',
  );
  await frame.getByText('Guide answer 2:', { exact: false }).waitFor();
  const second_request = await page.evaluate(() =>
    (window as any).__learning_test.generations
      .filter((request: any) =>
        request.messages[0].content.includes('You are a patient'),
      )
      .at(-1),
  );
  assert.deepEqual(second_request.messages[2], first_message);
  saved = (await readTopics())[0];
  assert.equal(saved.key_points[0].turns.length, 2);
  assert.deepEqual(
    saved.key_points[0].turns[0].assistant_message,
    first_message,
  );
  assert.equal(saved.key_points[0].memory.learned, true);
  assert.equal(
    saved.key_points[0].memory.source_turn_id,
    saved.key_points[0].turns[1].id,
  );
  assert.equal(
    await frame.getByRole('progressbar').getAttribute('aria-valuenow'),
    '1',
  );
  check(
    'two exploration turns persist and replay complete provider metadata unchanged',
  );
  check('demonstrated understanding updates learned progress automatically');
  await frame.locator('.saved-memory > summary').click();
  await frame.getByRole('button', { name: 'Edit memory', exact: true }).click();
  await frame.getByLabel('Your learning memory', { exact: true }).waitFor();
  const edited_memory =
    'I understand that a weight scales its input contribution; doubling the weight doubles that contribution.';
  await frame
    .getByLabel('Your learning memory', { exact: true })
    .fill(edited_memory);
  await frame
    .getByRole('button', { name: /02 Learning from mistakes/ })
    .click();
  await frame
    .getByRole('dialog')
    .getByRole('button', { name: 'Keep working', exact: true })
    .click();
  assert.equal(
    await frame
      .getByLabel('Your learning memory', { exact: true })
      .inputValue(),
    edited_memory,
  );
  assert.notEqual(
    (await readTopics())[0].key_points[0].memory.summary,
    edited_memory,
  );
  await frame
    .getByRole('button', { name: 'Save changes', exact: true })
    .click();
  await frame.getByText('Learning memory saved', { exact: true }).waitFor();
  saved = (await readTopics())[0];
  assert.equal(saved.key_points[0].memory.summary, edited_memory);
  assert.ok(saved.key_points[0].memory.updated_at);
  assert.equal(
    await frame.getByRole('progressbar').getAttribute('aria-valuenow'),
    '1',
  );
  check(
    'optional memory edits remain protected by an in-app confirmation dialog until saved',
  );
  await frame
    .getByLabel('Your question', { exact: true })
    .fill('An unsent question to keep.');
  await frame
    .getByRole('button', { name: /02 Learning from mistakes/ })
    .click();
  await frame
    .getByRole('dialog')
    .getByRole('button', { name: 'Keep working', exact: true })
    .click();
  assert.equal(
    await frame.getByLabel('Your question', { exact: true }).inputValue(),
    'An unsent question to keep.',
  );
  await frame.getByLabel('Your question', { exact: true }).fill('');
  check(
    'topic navigation preserves unsent questions when the learner keeps working',
  );
  await page.screenshot({ path: resolve(output_root, 'learning-desktop.png') });
  await frame
    .getByRole('button', { name: /02 Learning from mistakes/ })
    .click();
  await ask('How does an error guide a weight update?');
  const memory_request = await page.evaluate(() =>
    (window as any).__learning_test.generations
      .filter((request: any) =>
        request.messages[0].content.includes('You are a patient'),
      )
      .at(-1),
  );
  assert.equal(memory_request.messages.length, 2);
  const memory_context = JSON.parse(memory_request.messages.at(-1).content);
  assert.equal(memory_context.learning_memories.length, 1);
  assert.equal(
    memory_context.learning_memories[0].summary,
    saved.key_points[0].memory.summary,
  );
  assert.equal(memory_context.learning_memories[0].learned, true);
  check(
    'the next point receives saved memory without unrelated conversation history',
  );
  await frame.getByRole('tab', { name: /Memory/ }).click();
  await frame
    .getByText(saved.key_points[0].memory.summary, { exact: true })
    .waitFor();
  await page.screenshot({ path: resolve(output_root, 'memory-desktop.png') });
  await page.evaluate(() => {
    const iframe = document.getElementById('applet') as HTMLIFrameElement;
    iframe.src = iframe.src;
  });
  await frame
    .getByRole('heading', { name: 'How neural networks learn', exact: true })
    .waitFor();
  await frame.getByRole('tab', { name: /Memory/ }).click();
  await frame
    .getByText(saved.key_points[0].memory.summary, { exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(() => (window as any).__learning_test.ready_count),
    2,
  );
  check(
    'native storage restores topics, conversations, and memories after iframe reload',
  );
  await frame.getByRole('tab', { name: 'Explore', exact: true }).click();
  const before_cancel = (await readTopics())[0].key_points[1].turns.length;
  await page.evaluate(() => {
    (window as any).__learning_test.next_response = 'cancelled';
  });
  await frame
    .getByLabel('Your question', { exact: true })
    .fill('Please continue slowly.');
  await frame
    .getByRole('button', { name: 'Send question', exact: true })
    .click();
  await frame.getByRole('button', { name: 'Stop', exact: true }).click();
  await frame
    .getByText('Incomplete response · not saved', { exact: true })
    .waitFor();
  assert.equal(
    (await readTopics())[0].key_points[1].turns.length,
    before_cancel,
  );
  assert.equal(
    await frame.getByLabel('Your question', { exact: true }).inputValue(),
    'Please continue slowly.',
  );
  check(
    'cancellation reaches the native bridge, retains partial output and leaves the conversation unchanged',
  );
  await page.evaluate(() => {
    (window as any).__learning_test.next_response = 'failed';
  });
  await frame
    .getByRole('button', { name: 'Send question', exact: true })
    .click();
  await frame.getByText('Simulated model failure.', { exact: false }).waitFor();
  assert.equal(
    (await readTopics())[0].key_points[1].turns.length,
    before_cancel,
  );
  await frame
    .getByRole('button', { name: 'Send question', exact: true })
    .click();
  await frame.getByRole('status').waitFor({ state: 'hidden' });
  assert.equal(
    (await readTopics())[0].key_points[1].turns.length,
    before_cancel + 1,
  );
  check('failed generation preserves input and can be retried successfully');
  await page.evaluate(() => {
    (window as any).__learning_test.fail_next_memory = true;
  });
  await ask('What should I practice next?');
  await frame
    .getByRole('button', { name: 'Update memory', exact: true })
    .waitFor();
  const stale_point = (await readTopics())[0].key_points[1];
  assert.equal(stale_point.turns.length, before_cancel + 2);
  assert.notEqual(
    stale_point.memory.source_turn_id,
    stale_point.turns.at(-1).id,
  );
  const before_memory_retry = await page.evaluate(
    () => (window as any).__learning_test.exploration_count,
  );
  await frame
    .getByRole('button', { name: 'Update memory', exact: true })
    .click();
  await frame.getByRole('status').waitFor({ state: 'hidden' });
  const refreshed_point = (await readTopics())[0].key_points[1];
  assert.equal(
    refreshed_point.memory.source_turn_id,
    refreshed_point.turns.at(-1).id,
  );
  assert.equal(
    await page.evaluate(
      () => (window as any).__learning_test.exploration_count,
    ),
    before_memory_retry,
  );
  check(
    'automatic memory failure retains the exchange and retries memory without repeating the answer',
  );
  await page.evaluate(() => {
    (window as any).__learning_test.fail_next_write = true;
  });
  await ask('Give me one more concrete example.');
  await frame
    .getByRole('button', { name: 'Retry save', exact: true })
    .waitFor();
  const exploration_count = await page.evaluate(
    () => (window as any).__learning_test.exploration_count,
  );
  assert.equal(
    (await readTopics())[0].key_points[1].turns.length,
    before_cancel + 2,
  );
  assert.equal(
    await frame
      .getByRole('button', { name: 'New topic', exact: true })
      .isDisabled(),
    true,
  );
  await frame.getByRole('button', { name: 'Retry save', exact: true }).click();
  await frame
    .getByRole('button', { name: 'Retry save', exact: true })
    .waitFor({ state: 'hidden' });
  await frame.getByRole('status').waitFor({ state: 'hidden' });
  assert.equal(
    (await readTopics())[0].key_points[1].turns.length,
    before_cancel + 3,
  );
  assert.equal(
    await page.evaluate(
      () => (window as any).__learning_test.exploration_count,
    ),
    exploration_count,
  );
  check(
    'failed exchange persistence retries the saved answer then updates memory without repeating exploration',
  );
  await page.evaluate(() => {
    (window as any).__learning_test.fail_next_memory_write = true;
  });
  await ask('Connect that example to the next idea.');
  await frame
    .getByRole('button', { name: 'Retry save', exact: true })
    .waitFor();
  const before_memory_save_retry = await page.evaluate(
    () => (window as any).__learning_test.generations.length,
  );
  const before_memory_save_point = (await readTopics())[0].key_points[1];
  assert.notEqual(
    before_memory_save_point.memory.source_turn_id,
    before_memory_save_point.turns.at(-1).id,
  );
  await frame.getByRole('button', { name: 'Retry save', exact: true }).click();
  await frame.getByRole('status').waitFor({ state: 'hidden' });
  assert.equal(
    await page.evaluate(
      () => (window as any).__learning_test.generations.length,
    ),
    before_memory_save_retry,
  );
  const after_memory_save_point = (await readTopics())[0].key_points[1];
  assert.equal(
    after_memory_save_point.memory.source_turn_id,
    after_memory_save_point.turns.at(-1).id,
  );
  check(
    'failed memory persistence retries disk only and preserves its generated assessment',
  );
  await frame.getByRole('button', { name: /How neurons connect/ }).click();
  await page.evaluate(() => {
    (window as any).__learning_test.fail_next_memory = true;
  });
  await ask('How does this relate to learning from an error?');
  await frame
    .getByRole('button', { name: 'Update memory', exact: true })
    .waitFor();
  const old_memory_source = (await readTopics())[0].key_points[0].memory
    .source_turn_id;
  const correction_generation_count = await page.evaluate(
    () => (window as any).__learning_test.generations.length,
  );
  const unrelated_question = 'Keep this unrelated unsent question.';
  await frame
    .getByLabel('Your question', { exact: true })
    .fill(unrelated_question);
  const openMemory = async () => {
    if ((await frame.locator('.saved-memory').getAttribute('open')) === null) {
      await frame.locator('.saved-memory > summary').click();
    }
  };
  await openMemory();
  await page.evaluate(() => {
    (window as any).__learning_test.fail_next_write = true;
  });
  await frame
    .getByRole('button', { name: 'Mark as still exploring', exact: true })
    .click();
  await frame.getByRole('button', { name: 'Retry save', exact: true }).click();
  await frame.getByRole('status').waitFor({ state: 'hidden' });
  const corrected_memory = (await readTopics())[0].key_points[0].memory;
  assert.equal(corrected_memory.learned, false);
  assert.equal(corrected_memory.source_turn_id, old_memory_source);
  assert.equal(
    await frame.getByLabel('Your question', { exact: true }).inputValue(),
    unrelated_question,
  );
  assert.equal(
    await page.evaluate(
      () => (window as any).__learning_test.generations.length,
    ),
    correction_generation_count,
  );
  check(
    'retrying a failed progress correction preserves stale memory and does not invoke AI',
  );
  await openMemory();
  await frame.getByRole('button', { name: 'Edit memory', exact: true }).click();
  await frame
    .getByLabel('Your learning memory', { exact: true })
    .fill('A corrected note that still needs the latest exchange added.');
  await frame
    .getByRole('checkbox', { name: 'I understand this key point', exact: true })
    .check();
  await frame
    .getByRole('button', { name: 'Save changes', exact: true })
    .click();
  await frame.getByRole('status').waitFor({ state: 'hidden' });
  assert.equal(
    (await readTopics())[0].key_points[0].memory.source_turn_id,
    old_memory_source,
  );
  await frame
    .getByRole('button', { name: 'Update memory', exact: true })
    .waitFor();
  assert.equal(
    await frame.getByLabel('Your question', { exact: true }).inputValue(),
    unrelated_question,
  );
  check(
    'editing stale memory preserves its source turn and keeps Update memory available',
  );
  await openMemory();
  await page.evaluate(() => {
    (window as any).__learning_test.fail_next_write = true;
  });
  await frame
    .getByRole('button', { name: 'Mark as still exploring', exact: true })
    .click();
  await frame
    .getByRole('button', { name: 'Discard unsaved changes', exact: true })
    .click();
  await frame
    .getByRole('dialog')
    .getByRole('button', { name: 'Discard changes', exact: true })
    .click();
  await frame
    .getByRole('button', { name: 'Retry save', exact: true })
    .waitFor({ state: 'hidden' });
  assert.equal((await readTopics())[0].key_points[0].memory.learned, true);
  assert.equal(
    await frame.getByLabel('Your question', { exact: true }).inputValue(),
    unrelated_question,
  );
  assert.equal(
    await page.evaluate(
      () => (window as any).__learning_test.generations.length,
    ),
    correction_generation_count,
  );
  check(
    'discarding a failed progress save preserves unrelated question drafts',
  );
  await frame.getByLabel('Your question', { exact: true }).fill('');
  await frame
    .getByRole('button', { name: 'Update memory', exact: true })
    .click();
  await frame.getByRole('status').waitFor({ state: 'hidden' });
  if ((await frame.locator('.saved-memory').getAttribute('open')) !== null) {
    await frame.locator('.saved-memory > summary').click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await frame.getByRole('button', { name: 'Topics', exact: true }).waitFor();
  await page.screenshot({ path: resolve(output_root, 'learning-mobile.png') });
  const mobile_composer = await frame.locator('.composer').boundingBox();
  assert.ok(
    mobile_composer &&
      mobile_composer.y >= 0 &&
      mobile_composer.y + mobile_composer.height <= 845,
    `Mobile composer outside viewport: ${JSON.stringify(mobile_composer)}`,
  );
  const mobile_frame = page
    .frames()
    .find((candidate: { url(): string }) =>
      candidate.url().endsWith('/index.html'),
    );
  const metrics = await mobile_frame.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  assert.ok(
    metrics.width <= metrics.viewport + 1,
    `Horizontal overflow: ${JSON.stringify(metrics)}`,
  );
  await frame.getByRole('button', { name: 'Topics', exact: true }).click();
  await frame
    .getByRole('button', { name: 'New topic', exact: true })
    .waitFor({ state: 'visible' });
  await frame
    .getByRole('button', { name: 'Close topics', exact: true })
    .last()
    .click();
  check(
    'mobile layout has no horizontal overflow and its topic drawer operates',
  );
  await page.setViewportSize({ width: 390, height: 500 });
  await frame.getByLabel('Your question', { exact: true }).focus();
  const keyboard_composer = await frame.locator('.composer').boundingBox();
  assert.ok(
    keyboard_composer &&
      keyboard_composer.y >= 0 &&
      keyboard_composer.y + keyboard_composer.height <= 501,
    `Composer outside keyboard-sized viewport: ${JSON.stringify(keyboard_composer)}`,
  );
  await page.screenshot({
    path: resolve(output_root, 'learning-mobile-keyboard.png'),
  });
  check(
    'mobile composer stays visible at full-height and keyboard-sized viewports',
  );
  const preview = await context.newPage();
  preview.on('pageerror', (error: Error) => errors.push(error.message));
  await preview.goto(base + '/index.html');
  await preview
    .getByLabel('Your topic', { exact: true })
    .fill('Browser-only topic');
  await preview
    .getByRole('button', { name: 'Create topic', exact: true })
    .click();
  await preview
    .getByRole('heading', { name: 'Browser-only topic', exact: true })
    .waitFor();
  assert.equal(
    await preview
      .getByRole('button', { name: 'Generate key points', exact: true })
      .isDisabled(),
    true,
  );
  await preview.reload();
  await preview
    .getByRole('heading', { name: 'Browser-only topic', exact: true })
    .waitFor();
  check(
    'standalone preview persists topics and clearly disables unavailable host AI',
  );
  await preview.getByRole('button', { name: 'New topic', exact: true }).click();
  await preview
    .getByLabel('Your topic', { exact: true })
    .fill('A draft topic to keep');
  await preview
    .locator('.topic-item')
    .filter({ hasText: 'Browser-only topic' })
    .click();
  await preview
    .getByRole('dialog')
    .getByRole('button', { name: 'Keep working', exact: true })
    .click();
  assert.equal(
    await preview.getByLabel('Your topic', { exact: true }).inputValue(),
    'A draft topic to keep',
  );
  check('unsaved topic drafts survive cancelled navigation');
  assert.deepEqual(errors, []);
} catch (error) {
  console.error(error);
  if (test_page) {
    await test_page.screenshot({ path: resolve(output_root, 'failure.png') });
    console.error(
      await test_page
        .frameLocator('#applet')
        .locator('body')
        .innerText()
        .catch(() => 'No applet body'),
    );
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise<void>((done, fail) =>
    server.close((error) => (error ? fail(error) : done())),
  );
  await writeFile(
    resolve(output_root, 'report.json'),
    JSON.stringify({ checks, errors, passed: !process.exitCode }, null, 2),
  );
  console.log(JSON.stringify({ checks: checks.length, errors, output_root }));
}
