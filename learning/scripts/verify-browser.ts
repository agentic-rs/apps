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
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(
      '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}body{display:flex;flex-direction:column}.host-bar{box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;flex:0 0 56px;padding:0 16px;background:#f6f6f5;border-bottom:1px solid #ddd;font:15px system-ui;color:#333}.host-bar strong{font-weight:600}iframe{display:block;width:100%;min-height:0;flex:1;border:0}</style></head><body><div class="host-bar"><span>‹ Apell</span><strong>Learning</strong><span>•••</span></div><iframe id="applet" sandbox="allow-scripts"></iframe></body></html>',
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
          '.svg': 'image/svg+xml',
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
    viewport: { width: 390, height: 844 },
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
                image_input: 'unknown',
                pdf_input: 'unknown',
                audio_input: 'unknown',
                image_output: 'unknown',
                audio_output: 'unknown',
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
              media: [],
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
  const header = frame.locator('.navigation-bar');
  const back = (name: string) =>
    header.getByRole('button', { name, exact: true }).click();
  const openPoint = (title: string) =>
    frame.locator('.point-row').filter({ hasText: title }).click();
  const memoryCard = (title: string) =>
    frame.getByRole('article', { name: title, exact: true });
  const openMemory = () =>
    header.getByRole('button', { name: 'Memory', exact: true }).click();
  const readTopics = () =>
    page.evaluate(() =>
      [...(window as any).__learning_test.files.values()].map(
        (bytes: number[]) =>
          JSON.parse(new TextDecoder().decode(new Uint8Array(bytes))),
      ),
    );
  const ask = async (question: string) => {
    await frame.getByLabel('Your question', { exact: true }).fill(question);
    await frame
      .getByRole('button', { name: 'Send question', exact: true })
      .click();
    await frame.getByRole('status').waitFor({ state: 'hidden' });
  };
  const generationCount = () =>
    page.evaluate(() => (window as any).__learning_test.generations.length);
  const explorationCount = () =>
    page.evaluate(() => (window as any).__learning_test.exploration_count);
  const latestExploration = () =>
    page.evaluate(() =>
      (window as any).__learning_test.generations
        .filter((request: any) =>
          request.messages[0].content.includes('You are a patient'),
        )
        .at(-1),
    );
  const keepWorking = () =>
    frame
      .getByRole('dialog')
      .getByRole('button', { name: 'Keep working', exact: true })
      .click();
  const first_point = 'How neurons connect';
  const second_point = 'Learning from mistakes';
  const topic_title = 'How neural networks learn';
  await header.getByRole('heading', { name: 'Topics', exact: true }).waitFor();
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
  assert.equal(await native_frame.evaluate(() => innerHeight), 788);
  await frame
    .locator('.app-icon')
    .evaluate((element: HTMLImageElement) => element.decode());
  assert.ok(
    await frame
      .locator('.app-icon')
      .evaluate((element: HTMLImageElement) => element.naturalWidth > 0),
    'Official Learning icon must load inside the applet sandbox',
  );
  await page.screenshot({
    path: resolve(output_root, 'topics-empty-mobile.png'),
  });
  check(
    'mobile app boots below a 56px Apell bar in an opaque iframe with native bridge and restrictive CSP',
  );
  await header.getByRole('button', { name: 'New topic', exact: true }).click();
  await frame.getByLabel('Your topic', { exact: true }).fill(topic_title);
  await frame
    .getByLabel('Your goal', { exact: false })
    .fill('Understand the foundations and explain them in my own words.');
  await page.screenshot({ path: resolve(output_root, 'new-topic-mobile.png') });
  await frame
    .getByRole('button', { name: 'Create topic', exact: true })
    .click();
  await header
    .getByRole('heading', { name: topic_title, exact: true })
    .waitFor();
  await frame.getByRole('button', { name: /AI model/ }).click();
  await frame.getByRole('button', { name: /AI model test-model/ }).waitFor();
  await frame
    .getByRole('button', { name: 'Generate key points', exact: true })
    .click();
  await frame.locator('.point-row').filter({ hasText: first_point }).waitFor();
  let saved = (await readTopics())[0];
  assert.equal(saved.key_points.length, 4);
  assert.equal(saved.model.model_id, 'test-model');
  assert.match(saved.id, /^[0-9a-f-]+$/);
  assert.equal(
    await frame.getByRole('button', { name: /AI model/ }).count(),
    0,
  );
  await header
    .getByRole('button', { name: 'Topic options', exact: true })
    .click();
  await frame
    .getByRole('dialog')
    .getByText('Model: test-model', { exact: true })
    .waitFor();
  await frame
    .getByRole('dialog')
    .getByRole('button', { name: 'Done', exact: true })
    .click();
  check(
    'dedicated topic form and overview choose a model, persist four key points, and keep the model locked',
  );
  await openPoint(first_point);
  await header
    .getByRole('heading', { name: first_point, exact: true })
    .waitFor();
  assert.equal(await frame.locator('.topic-overview').count(), 0);
  await ask('What is a weight?');
  saved = (await readTopics())[0];
  assert.equal(saved.key_points[0].memory.learned, false);
  assert.equal(
    saved.key_points[0].memory.source_turn_id,
    saved.key_points[0].turns[0].id,
  );
  const first_message = saved.key_points[0].turns[0].assistant_message;
  check(
    'the first exchange automatically saves memory without treating an explanation as learned',
  );
  await ask(
    'I understand: doubling the weight doubles its input contribution.',
  );
  const second_request = await latestExploration();
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
  check(
    'two exploration turns persist and replay complete provider metadata unchanged',
  );
  await back('Key points');
  assert.equal(
    await frame.getByRole('progressbar').getAttribute('aria-valuenow'),
    '1',
  );
  await page.screenshot({ path: resolve(output_root, 'topic-mobile.png') });
  check('demonstrated understanding updates learned progress automatically');
  await openPoint(first_point);
  await openMemory();
  await memoryCard(first_point)
    .getByRole('button', { name: 'Edit memory', exact: true })
    .click();
  const edited_memory =
    'I understand that a weight scales its input contribution; doubling the weight doubles that contribution.';
  await frame
    .getByLabel('Your learning memory', { exact: true })
    .fill(edited_memory);
  await back('Memory');
  await keepWorking();
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
  await memoryCard(first_point).waitFor();
  saved = (await readTopics())[0];
  assert.equal(saved.key_points[0].memory.summary, edited_memory);
  assert.ok(saved.key_points[0].memory.updated_at);
  check(
    'optional memory edits have a dedicated screen and protected Back navigation until saved',
  );
  await back('Chat');
  const question_draft = 'An unsent question to keep.';
  await frame.getByLabel('Your question', { exact: true }).fill(question_draft);
  await back('Key points');
  await keepWorking();
  await header
    .getByRole('heading', { name: first_point, exact: true })
    .waitFor();
  assert.equal(
    await frame.getByLabel('Your question', { exact: true }).inputValue(),
    question_draft,
  );
  await frame.getByLabel('Your question', { exact: true }).fill('');
  check(
    'chat Back to key points preserves an unsent question when the learner keeps working',
  );
  await back('Key points');
  await openPoint(second_point);
  await ask('How does an error guide a weight update?');
  const memory_request = await latestExploration();
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
  await openMemory();
  await memoryCard(first_point)
    .getByText(edited_memory, { exact: true })
    .waitFor();
  await page.screenshot({ path: resolve(output_root, 'memory-mobile.png') });
  await back('Chat');
  await back('Key points');
  await back('Topics');
  await frame.locator('.topic-row').filter({ hasText: topic_title }).waitFor();
  await page.screenshot({ path: resolve(output_root, 'topics-mobile.png') });
  await page.evaluate(() => {
    const iframe = document.getElementById('applet') as HTMLIFrameElement;
    iframe.src = iframe.src;
  });
  await header.getByRole('heading', { name: 'Topics', exact: true }).waitFor();
  await frame.locator('.topic-row').filter({ hasText: topic_title }).click();
  await frame.getByRole('button', { name: /Learning memory/ }).click();
  await memoryCard(first_point)
    .getByText(edited_memory, { exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(() => (window as any).__learning_test.ready_count),
    2,
  );
  check(
    'native storage restores topic list, conversations, and memories after iframe reload',
  );
  await back('Key points');
  await openPoint(second_point);
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
  const before_memory_retry = await explorationCount();
  await frame
    .getByRole('button', { name: 'Update memory', exact: true })
    .click();
  await frame.getByRole('status').waitFor({ state: 'hidden' });
  const refreshed_point = (await readTopics())[0].key_points[1];
  assert.equal(
    refreshed_point.memory.source_turn_id,
    refreshed_point.turns.at(-1).id,
  );
  assert.equal(await explorationCount(), before_memory_retry);
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
  const exploration_count = await explorationCount();
  assert.equal(
    (await readTopics())[0].key_points[1].turns.length,
    before_cancel + 2,
  );
  assert.equal(
    await header
      .getByRole('button', { name: 'Key points', exact: true })
      .isDisabled(),
    true,
  );
  await frame.getByRole('button', { name: 'Retry save', exact: true }).click();
  await frame.getByRole('status').waitFor({ state: 'hidden' });
  assert.equal(
    (await readTopics())[0].key_points[1].turns.length,
    before_cancel + 3,
  );
  assert.equal(await explorationCount(), exploration_count);
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
  const before_memory_save_retry = await generationCount();
  const before_memory_save_point = (await readTopics())[0].key_points[1];
  assert.notEqual(
    before_memory_save_point.memory.source_turn_id,
    before_memory_save_point.turns.at(-1).id,
  );
  await frame.getByRole('button', { name: 'Retry save', exact: true }).click();
  await frame.getByRole('status').waitFor({ state: 'hidden' });
  assert.equal(await generationCount(), before_memory_save_retry);
  const after_memory_save_point = (await readTopics())[0].key_points[1];
  assert.equal(
    after_memory_save_point.memory.source_turn_id,
    after_memory_save_point.turns.at(-1).id,
  );
  check(
    'failed memory persistence retries disk only and preserves its generated assessment',
  );
  await back('Key points');
  await openPoint(first_point);
  await openMemory();
  await memoryCard(second_point)
    .getByRole('button', { name: 'Edit memory', exact: true })
    .click();
  await frame
    .getByLabel('Your learning memory', { exact: true })
    .fill('An edited note for the second point.');
  await frame
    .getByRole('button', { name: 'Save changes', exact: true })
    .click();
  await memoryCard(second_point).waitFor();
  await back('Chat');
  await header
    .getByRole('heading', { name: first_point, exact: true })
    .waitFor();
  check(
    'Memory returns to its originating chat after editing a different point',
  );
  await page.evaluate(() => {
    (window as any).__learning_test.fail_next_memory = true;
  });
  await ask('How does this relate to learning from an error?');
  await frame
    .getByRole('button', { name: 'Update memory', exact: true })
    .waitFor();
  const old_memory_source = (await readTopics())[0].key_points[0].memory
    .source_turn_id;
  const correction_generation_count = await generationCount();
  const unrelated_question = 'Keep this unrelated unsent question.';
  await frame
    .getByLabel('Your question', { exact: true })
    .fill(unrelated_question);
  await openMemory();
  await memoryCard(second_point)
    .getByRole('button', { name: 'Edit memory', exact: true })
    .click();
  await keepWorking();
  await memoryCard(first_point).waitFor();
  await back('Chat');
  assert.equal(
    await frame.getByLabel('Your question', { exact: true }).inputValue(),
    unrelated_question,
  );
  check(
    'editing another point memory cannot silently discard an unsent chat question',
  );
  await openMemory();
  await page.evaluate(() => {
    (window as any).__learning_test.fail_next_write = true;
  });
  await memoryCard(first_point)
    .getByRole('button', { name: 'Mark as still exploring', exact: true })
    .click();
  await frame.getByRole('button', { name: 'Retry save', exact: true }).click();
  await frame.getByRole('status').waitFor({ state: 'hidden' });
  const corrected_memory = (await readTopics())[0].key_points[0].memory;
  assert.equal(corrected_memory.learned, false);
  assert.equal(corrected_memory.source_turn_id, old_memory_source);
  assert.equal(await generationCount(), correction_generation_count);
  await back('Chat');
  assert.equal(
    await frame.getByLabel('Your question', { exact: true }).inputValue(),
    unrelated_question,
  );
  check(
    'retrying a failed progress correction preserves stale memory and does not invoke AI',
  );
  await openMemory();
  await memoryCard(first_point)
    .getByRole('button', { name: 'Edit memory', exact: true })
    .click();
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
  await back('Chat');
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
  await memoryCard(first_point)
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
  assert.equal(await generationCount(), correction_generation_count);
  await back('Chat');
  assert.equal(
    await frame.getByLabel('Your question', { exact: true }).inputValue(),
    unrelated_question,
  );
  check(
    'discarding a failed progress save preserves unrelated question drafts',
  );
  await frame.getByLabel('Your question', { exact: true }).fill('');
  await frame
    .getByRole('button', { name: 'Update memory', exact: true })
    .click();
  await frame.getByRole('status').waitFor({ state: 'hidden' });
  const checkComposer = async (height: number) => {
    const back_box = await header.locator('.nav-back').boundingBox();
    const title_box = await header.locator('.navigation-title').boundingBox();
    assert.ok(
      back_box && title_box && back_box.x + back_box.width + 4 <= title_box.x,
      `Navigation back control crowds the title: ${JSON.stringify({ back_box, title_box })}`,
    );
    const composer = await frame.locator('.composer').boundingBox();
    assert.ok(
      composer &&
        composer.y >= 56 &&
        composer.y + composer.height <= height + 1,
      `Composer outside Apell applet viewport: ${JSON.stringify(composer)}`,
    );
    const metrics = await native_frame.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: innerWidth,
      height: innerHeight,
      app_height: document
        .querySelector('.learning-app')!
        .getBoundingClientRect().height,
    }));
    assert.ok(
      metrics.width <= metrics.viewport + 1,
      `Horizontal overflow: ${JSON.stringify(metrics)}`,
    );
    assert.equal(metrics.height, height - 56);
    assert.ok(
      Math.abs(metrics.app_height - metrics.height) <= 1,
      `App does not fill its host iframe: ${JSON.stringify(metrics)}`,
    );
  };
  await checkComposer(844);
  await page.screenshot({ path: resolve(output_root, 'chat-mobile.png') });
  check(
    'mobile conversation fills the Apell applet viewport with no horizontal overflow and a visible composer',
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await checkComposer(1000);
  assert.equal(await frame.locator('.conversation-screen').count(), 1);
  assert.equal(
    await frame.locator('.topic-overview, .topics-screen').count(),
    0,
  );
  await page.screenshot({ path: resolve(output_root, 'chat-wide.png') });
  check(
    'wide windows retain one app screen instead of exposing a multi-pane website layout',
  );
  await page.setViewportSize({ width: 390, height: 500 });
  await frame.getByLabel('Your question', { exact: true }).focus();
  await checkComposer(500);
  await page.screenshot({
    path: resolve(output_root, 'chat-mobile-keyboard.png'),
  });
  check(
    'mobile composer stays visible with a 56px host bar and a keyboard-sized viewport',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await back('Key points');
  await back('Topics');
  await header.getByRole('button', { name: 'New topic', exact: true }).click();
  await frame.getByLabel('Your topic', { exact: true }).fill('Unsaved topic');
  await page.evaluate(() => {
    (window as any).__learning_test.fail_next_write = true;
  });
  await frame
    .getByRole('button', { name: 'Create topic', exact: true })
    .click();
  await frame
    .getByRole('button', { name: 'Discard unsaved changes', exact: true })
    .click();
  await frame
    .getByRole('dialog')
    .getByRole('button', { name: 'Discard changes', exact: true })
    .click();
  await header.getByRole('heading', { name: 'Topics', exact: true }).waitFor();
  assert.equal(await frame.locator('.topic-row').count(), 1);
  assert.equal((await readTopics()).length, 1);
  assert.equal(await frame.locator('.topic-overview').count(), 0);
  check(
    'discarding a failed new-topic save returns to Topics without opening an unrelated existing topic',
  );
  const preview = await context.newPage();
  preview.on('pageerror', (error: Error) => errors.push(error.message));
  await preview.goto(base + '/index.html');
  await preview.getByRole('button', { name: 'New topic', exact: true }).click();
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
    .locator('.topic-row')
    .filter({ hasText: 'Browser-only topic' })
    .click();
  await preview
    .getByRole('heading', { name: 'Browser-only topic', exact: true })
    .waitFor();
  check(
    'standalone preview persists topics and clearly disables unavailable host AI',
  );
  await preview.getByRole('button', { name: 'Topics', exact: true }).click();
  await preview.getByRole('button', { name: 'New topic', exact: true }).click();
  await preview
    .getByLabel('Your topic', { exact: true })
    .fill('A draft topic to keep');
  await preview.getByRole('button', { name: 'Topics', exact: true }).click();
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
