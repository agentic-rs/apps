import { describe, expect, test } from 'bun:test';
import {
  createId,
  createRecording,
  fileName,
  formatTime,
  isSafePath,
  parseRecording,
  transcriptText,
} from '../src/lib/recordings';

const asset = {
  path: 'recordings/fixture.m4a',
  file_name: 'A meeting.m4a',
  mime_type: 'audio/mp4',
  duration_ms: 12_000,
  size_bytes: 25_000,
};

describe('recording persistence boundary', () => {
  test('creates safe unique identities when randomUUID is absent in an opaque iframe', () => {
    const source = { getRandomValues: crypto.getRandomValues.bind(crypto) };
    const first = createId(source);
    const second = createId(source);
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(second).not.toBe(first);
  });
  test('imports retain a useful title and validate after JSON round-trip', () => {
    const recording = createRecording(asset, 'import');
    expect(recording.title).toBe('A meeting');
    expect(parseRecording(JSON.parse(JSON.stringify(recording)))).toEqual(recording);
  });

  test('rejects malformed records and non-finite audio metadata', () => {
    const valid = createRecording(asset, 'microphone');
    for (const change of [
      { id: '../escaped' },
      { duration_ms: Infinity },
      { size_bytes: -1 },
      { created_at: 'not a date' },
      { transcript: {} },
      { schema_version: 2 },
    ]) {
      expect(() => parseRecording({ ...valid, ...change })).toThrow();
    }
  });

  test('rejects audio paths that could escape the applet file area', () => {
    const valid = createRecording(asset, 'microphone');
    for (const path of [
      '/private.m4a',
      '../private.m4a',
      'recordings/../../file',
      'recordings//file',
      'C:\\file',
      'recordings/./file',
      'file\0name',
    ]) {
      expect(isSafePath(path)).toBe(false);
      expect(() => parseRecording({ ...valid, path })).toThrow();
    }
    expect(isSafePath('recordings/a-note.m4a')).toBe(true);
  });

  test('accepts multilingual text and rejects invalid transcript timing', () => {
    const recording = {
      ...createRecording(asset, 'import'),
      transcript: {
        text: '你好，世界。',
        language: 'zh',
        segments: [{ start_ms: 0, end_ms: 2_000, text: '你好，世界。' }],
      },
    };
    expect(parseRecording(recording).transcript?.text).toBe('你好，世界。');
    expect(() =>
      parseRecording({
        ...recording,
        transcript: {
          ...recording.transcript,
          segments: [{ start_ms: 500, end_ms: 10, text: 'bad' }],
        },
      }),
    ).toThrow();
  });
});

describe('export and display', () => {
  test('exports edited text verbatim without stale segment text', () => {
    const recording = {
      ...createRecording(asset, 'import'),
      transcript_edited: true,
      transcript: {
        text: 'Corrected name: Renée\nA second paragraph.',
        language: 'en',
        segments: [{ start_ms: 0, end_ms: 10, text: 'Incorrect name' }],
      },
    };
    const exported = transcriptText(recording);
    expect(exported).toContain('Corrected name: Renée\nA second paragraph.');
    expect(exported).not.toContain('Incorrect name');
  });

  test('formatting handles hour-long recordings and safe export names', () => {
    expect(formatTime(3_661_000)).toBe('1:01:01');
    expect(formatTime(59_999)).toBe('0:59');
    expect(formatTime(-3)).toBe('0:00');
    expect(fileName('../notes: today?', 'txt')).toBe('..-notes- today-.txt');
    expect(fileName('', 'txt')).toBe('Recording.txt');
  });
});
