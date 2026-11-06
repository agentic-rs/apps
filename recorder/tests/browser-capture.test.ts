import { expect, test } from 'bun:test';
import { IDBFactory } from 'fake-indexeddb';
import { createBrowserPlatform } from '../src/lib/browser';

class FakeRecorder {
  static isTypeSupported(type: string) {
    return type === 'audio/mp4';
  }
  state = 'inactive';
  mimeType = 'audio/mp4';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onerror: (() => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    this.state = 'recording';
  }
  stop() {
    this.ondataavailable?.({ data: new Blob(['test'], { type: this.mimeType }) });
    this.state = 'inactive';
    this.onstop?.();
  }
  pause() {
    this.state = 'paused';
  }
  resume() {
    this.state = 'recording';
  }
}

function globals(getUserMedia: () => Promise<unknown>) {
  const keys = ['indexedDB', 'navigator', 'MediaRecorder'] as const;
  const prior = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  const values = [new IDBFactory(), { mediaDevices: { getUserMedia } }, FakeRecorder];
  keys.forEach((key, index) =>
    Object.defineProperty(globalThis, key, { configurable: true, value: values[index] }),
  );
  return () =>
    keys.forEach((key, index) => {
      if (prior[index]) Object.defineProperty(globalThis, key, prior[index]!);
      else Reflect.deleteProperty(globalThis, key);
    });
}

test('browser capture keeps its start path through stop and draft recovery', async () => {
  const restore = globals(async () => ({ getTracks: () => [{ stop() {} }] }));
  try {
    const platform = createBrowserPlatform();
    const capture = await platform.start();
    await platform.store.saveCapture({
      schema_version: 1,
      id: 'test-capture',
      mode: 'clip',
      channel_id: 'test-channel',
      started_at: new Date().toISOString(),
      ...capture,
    });
    const audio = await platform.stop();
    expect(audio.path).toBe(capture.path);
    const [recording] = await platform.store.list();
    expect(recording).toMatchObject({
      id: 'test-capture',
      path: capture.path,
      mode: 'clip',
      channel_id: 'test-channel',
      transcription_state: 'queued',
    });
    platform.dispose();
  } finally {
    restore();
  }
});

test('late browser permission grants cannot start capture after disposal', async () => {
  let grant!: (stream: unknown) => void;
  let stopped = false;
  const permission = new Promise((resolve) => {
    grant = resolve;
  });
  const restore = globals(() => permission);
  try {
    const platform = createBrowserPlatform();
    const started = platform.start();
    platform.dispose();
    grant({
      getTracks: () => [
        {
          stop() {
            stopped = true;
          },
        },
      ],
    });
    await expect(started).rejects.toThrow('closed');
    expect(stopped).toBe(true);
  } finally {
    restore();
  }
});
