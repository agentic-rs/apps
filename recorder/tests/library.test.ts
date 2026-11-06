import { describe, expect, test } from 'bun:test';
import { RecorderLibrary } from '../src/lib/library';
import { createChannel, createRecording } from '../src/lib/recordings';
import type {
  Channel,
  RecorderPlatform,
  Recording,
  SpeechStatus,
  Transcript,
} from '../src/lib/types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for queue state.');
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
const transcript: Transcript = {
  text: 'A useful thought.',
  language: 'en',
  segments: [{ start_ms: 0, end_ms: 1_000, text: 'A useful thought.' }],
  duration_ms: 1_000,
};
const channel = createChannel('Ideas');
function clip(time = '2026-01-01T12:00:00.000Z') {
  return createRecording(
    {
      path: `recordings/${crypto.randomUUID()}.m4a`,
      file_name: 'Clip.m4a',
      mime_type: 'audio/mp4',
      duration_ms: 1_000,
      size_bytes: 100,
    },
    'microphone',
    { mode: 'clip', channel_id: channel.id, started_at: time },
  );
}
function fixture(saved: Recording[] = [], model_ready = true) {
  const recordings = new Map(saved.map((recording) => [recording.id, structuredClone(recording)]));
  const channels = new Map<string, Channel>([[channel.id, channel]]);
  const calls: {
    path: string;
    language?: string;
    result: ReturnType<typeof deferred<Transcript>>;
  }[] = [];
  let fail_save = false;
  let fail_remove = false;
  const speech: SpeechStatus = {
    model_ready,
    model_size_bytes: 1,
    busy: false,
    progress: 0,
    stage: 'idle',
  };
  const platform: RecorderPlatform = {
    native: true,
    store: {
      list: async () => [...recordings.values()].map((recording) => structuredClone(recording)),
      save: async (recording) => {
        if (fail_save) throw new Error('Storage full');
        recordings.set(recording.id, structuredClone(recording));
      },
      remove: async (recording) => {
        if (fail_remove) throw new Error('Removal failed');
        recordings.delete(recording.id);
      },
      listChannels: async () => [...channels.values()],
      saveChannel: async (value) => {
        channels.set(value.id, value);
      },
      removeChannel: async (id) => {
        channels.delete(id);
      },
      saveCapture: async () => {},
      clearCapture: async () => {},
    },
    capabilities: async () => ({ recording: true, import: true, sharing: true, playback: true }),
    start: async () => ({ path: 'recordings/fixture.m4a', mime_type: 'audio/mp4' }),
    pause: async () => {},
    resume: async () => {},
    stop: async () => clip(),
    importAudio: async () => null,
    shareAudio: async () => {},
    shareTranscript: async () => {},
    play: async () => {},
    pausePlayback: async () => {},
    seek: async () => {},
    status: async () => ({
      recording_state: 'idle',
      elapsed_ms: 0,
      playing: false,
      position_ms: 0,
      duration_ms: 0,
    }),
    speechStatus: async () => ({ ...speech }),
    downloadModel: async () => {
      speech.model_ready = true;
    },
    transcribe: (path, language) => {
      const result = deferred<Transcript>();
      calls.push({ path, language, result });
      return result.promise;
    },
    cancelSpeech: async () => {},
    dispose() {},
  };
  const library = new RecorderLibrary(platform);
  return {
    library,
    calls,
    recordings,
    speech,
    failRemove: (value: boolean) => {
      fail_remove = value;
    },
    failSave: (value: boolean) => {
      fail_save = value;
    },
  };
}

describe('durable channel transcription queue', () => {
  test('serializes clips in recording order while allowing the next clip to save', async () => {
    const first = clip();
    const second = clip('2026-01-01T12:01:00.000Z');
    const f = fixture([first]);
    await f.library.load();
    await until(() => f.calls.length === 1);
    await f.library.add(second);
    expect(f.recordings.get(second.id)?.transcription_state).toBe('queued');
    expect(f.calls).toHaveLength(1);
    f.calls[0].result.resolve(transcript);
    await until(() => f.calls.length === 2);
    expect(f.calls[1].path).toBe(second.path);
    f.calls[1].result.resolve(transcript);
    await until(() => f.library.getSnapshot().job === null);
    expect(f.recordings.get(first.id)?.transcript?.text).toBe(transcript.text);
    expect(f.recordings.get(second.id)?.transcription_state).toBe('complete');
    f.library.dispose();
  });

  test('waits for an explicitly downloaded model and resumes interrupted jobs', async () => {
    const recording = {
      ...clip(),
      transcription_state: 'running' as const,
      transcription_language: 'zh',
    };
    const f = fixture([recording], false);
    await f.library.load();
    expect(f.recordings.get(recording.id)?.transcription_state).toBe('queued');
    expect(f.calls).toHaveLength(0);
    await f.library.downloadModel();
    await until(() => f.calls.length === 1);
    expect(f.calls[0].language).toBe('zh');
    f.calls[0].result.resolve(transcript);
    await until(() => f.library.getSnapshot().job === null);
    f.library.dispose();
  });

  test('merges results with a renamed clip instead of restoring a stale title', async () => {
    const recording = clip();
    const f = fixture([recording]);
    await f.library.load();
    await until(() => f.calls.length === 1);
    await f.library.saveEdit({
      ...f.library.find(recording.id)!,
      title: 'Renamed while transcribing',
    });
    f.calls[0].result.resolve(transcript);
    await until(() => f.library.getSnapshot().job === null);
    expect(f.recordings.get(recording.id)?.title).toBe('Renamed while transcribing');
    expect(f.recordings.get(recording.id)?.transcript?.text).toBe(transcript.text);
    f.library.dispose();
  });

  test('never overwrites an edited transcript with a late speech result', async () => {
    const recording = clip();
    const f = fixture([recording]);
    await f.library.load();
    await until(() => f.calls.length === 1);
    await f.library.saveEdit({
      ...f.library.find(recording.id)!,
      transcript: { ...transcript, text: 'My corrected text' },
    });
    f.calls[0].result.resolve(transcript);
    await until(() => f.library.getSnapshot().job === null);
    expect(f.recordings.get(recording.id)?.transcript?.text).toBe('My corrected text');
    expect(f.recordings.get(recording.id)?.transcript_edited).toBe(true);
    f.library.dispose();
  });

  test('does not resurrect a deleted clip when native cancellation finishes late', async () => {
    const recording = clip();
    const f = fixture([recording]);
    await f.library.load();
    await until(() => f.calls.length === 1);
    await f.library.remove(recording.id);
    f.calls[0].result.resolve(transcript);
    await until(() => f.library.getSnapshot().job === null);
    expect(f.library.find(recording.id)).toBeUndefined();
    expect(f.recordings.has(recording.id)).toBe(false);
    f.library.dispose();
  });

  test('persists cancellation and does not resume it on reopening', async () => {
    const recording = clip();
    const f = fixture([recording]);
    await f.library.load();
    await until(() => f.calls.length === 1);
    await f.library.cancel(recording.id);
    f.calls[0].result.resolve(transcript);
    await until(() => f.library.getSnapshot().job === null);
    expect(f.recordings.get(recording.id)?.transcription_state).toBe('cancelled');
    expect(f.recordings.get(recording.id)?.transcript).toBeNull();
    f.library.dispose();
    const reopened = fixture([...f.recordings.values()]);
    await reopened.library.load();
    expect(reopened.calls).toHaveLength(0);
    reopened.library.dispose();
  });

  test('keeps generated text visible and retryable after a storage failure', async () => {
    const recording = clip();
    const f = fixture([recording]);
    await f.library.load();
    await until(() => f.calls.length === 1);
    f.failSave(true);
    f.calls[0].result.resolve(transcript);
    await until(() => f.library.getSnapshot().job === null);
    expect(f.library.getSnapshot().pending_recording?.transcript?.text).toBe(transcript.text);
    expect(f.library.find(recording.id)?.transcript?.text).toBe(transcript.text);
    f.failSave(false);
    await f.library.retrySave();
    expect(f.library.getSnapshot().pending_recording).toBeNull();
    expect(f.recordings.get(recording.id)?.transcription_state).toBe('complete');
    f.library.dispose();
  });

  test('rejects deleting a populated channel', async () => {
    const f = fixture([clip()], false);
    await f.library.load();
    await expect(f.library.removeChannel(channel.id)).rejects.toThrow('empty channels');
    expect(f.library.getSnapshot().channels.some((item) => item.id === channel.id)).toBe(true);
    f.library.dispose();
  });

  test('retains both a newly captured clip and a completed transcript when their saves fail together', async () => {
    const first = clip();
    const second = clip('2026-01-01T12:01:00.000Z');
    const f = fixture([first]);
    await f.library.load();
    await until(() => f.calls.length === 1);
    f.failSave(true);
    await expect(f.library.add(second)).rejects.toThrow('Storage full');
    f.calls[0].result.resolve(transcript);
    await until(() => f.library.getSnapshot().job === null);
    expect(f.library.find(first.id)?.transcript?.text).toBe(transcript.text);
    expect(f.library.find(second.id)?.transcription_state).toBe('queued');
    f.failSave(false);
    await f.library.retrySave();
    await until(() => f.calls.length === 2);
    expect(f.recordings.get(first.id)?.transcript?.text).toBe(transcript.text);
    expect(f.recordings.has(second.id)).toBe(true);
    f.calls[1].result.resolve(transcript);
    await until(() => f.library.getSnapshot().job === null);
    expect(f.library.getSnapshot().pending_recording).toBeNull();
    f.library.dispose();
  });
  test('a failed deletion leaves cancelled transcription retryable instead of stuck running', async () => {
    const recording = clip();
    const f = fixture([recording]);
    await f.library.load();
    await until(() => f.calls.length === 1);
    f.failRemove(true);
    await expect(f.library.remove(recording.id)).rejects.toThrow('Removal failed');
    f.calls[0].result.reject(new Error('Speech cancelled'));
    await until(() => f.library.getSnapshot().job === null);
    expect(f.library.find(recording.id)?.transcription_state).toBe('cancelled');
    expect(f.recordings.get(recording.id)?.transcription_state).toBe('cancelled');
    await f.library.enqueue(recording.id);
    await until(() => f.calls.length === 2);
    f.calls[1].result.resolve(transcript);
    await until(() => f.library.getSnapshot().job === null);
    expect(f.library.find(recording.id)?.transcription_state).toBe('complete');
    f.library.dispose();
  });
  test('title-only save from a stale UI render preserves the newest transcript', async () => {
    const recording = clip();
    const f = fixture([recording]);
    await f.library.load();
    await until(() => f.calls.length === 1);
    const stale = { ...f.library.find(recording.id)! };
    f.calls[0].result.resolve(transcript);
    await until(() => f.library.getSnapshot().job === null);
    await f.library.saveEdit({ ...stale, title: 'My title' }, { title: true, transcript: false });
    expect(f.recordings.get(recording.id)?.transcript?.text).toBe(transcript.text);
    expect(f.recordings.get(recording.id)?.title).toBe('My title');
    expect(f.recordings.get(recording.id)?.transcription_state).toBe('complete');
    f.library.dispose();
  });
});
