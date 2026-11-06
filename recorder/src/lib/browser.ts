import { createId, fileName, parseRecording, transcriptText } from './recordings';
import type { AudioAsset, AudioStatus, RecorderPlatform, Recording } from './types';

const max_audio_bytes = 128 * 1_024 * 1_024;
const unsupported_speech =
  'On-device transcription runs in Apell. Install the recorder applet in the updated mobile host.';

type StoreName = 'recordings' | 'audio';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('apell-recorder-preview', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('recordings', { keyPath: 'id' });
      request.result.createObjectStore('audio');
    };
    request.onerror = () =>
      reject(new Error('Browser storage is unavailable. Check the browser’s storage permissions.'));
    request.onsuccess = () => resolve(request.result);
  });
}

async function databaseRequest<T>(
  store_name: StoreName,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(store_name, mode);
    const request = action(transaction.objectStore(store_name));
    transaction.oncomplete = () => {
      database.close();
      resolve(request.result);
    };
    transaction.onerror = () => {
      database.close();
      reject(new Error('Could not access browser storage. Check available disk space.'));
    };
    transaction.onabort = transaction.onerror;
  });
}

async function removeRecording(recording: Recording): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['recordings', 'audio'], 'readwrite');
    transaction.objectStore('recordings').delete(recording.id);
    transaction.objectStore('audio').delete(recording.path);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(new Error('Could not delete this recording.'));
    };
    transaction.onabort = transaction.onerror;
  });
}

function chooseAudio(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*,.m4a,.mp3,.wav,.flac,.ogg,.webm';
    input.hidden = true;
    document.body.append(input);
    const finish = (file: File | null) => {
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => finish(null), { once: true });
    input.click();
  });
}

async function audioDuration(blob: Blob): Promise<number> {
  const source = URL.createObjectURL(blob);
  const player = new Audio();
  try {
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Could not read the audio file. Try another format.')),
        10_000,
      );
      player.onloadedmetadata = () => {
        clearTimeout(timeout);
        resolve(Number.isFinite(player.duration) ? player.duration * 1_000 : 0);
      };
      player.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('This browser cannot open this audio format.'));
      };
      player.src = source;
    });
  } finally {
    player.src = '';
    URL.revokeObjectURL(source);
  }
}

async function shareFile(file: File): Promise<void> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) throw error;
    }
    return;
  }
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function createBrowserPlatform(): RecorderPlatform {
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];
  let elapsed_ms = 0;
  let active_since = 0;
  let recording_error: Error | null = null;
  let player: HTMLAudioElement | null = null;
  let playback_url: string | null = null;
  let playback_path: string | null = null;
  const elapsed = () =>
    elapsed_ms + (recorder?.state === 'recording' ? performance.now() - active_since : 0);
  const releaseStream = () => {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  };
  const releasePlayer = () => {
    player?.pause();
    if (player) player.src = '';
    if (playback_url) URL.revokeObjectURL(playback_url);
    playback_url = null;
    playback_path = null;
    player = null;
  };
  const getBlob = async (path: string): Promise<Blob> => {
    const blob = await databaseRequest<Blob | undefined>('audio', 'readonly', (store) =>
      store.get(path),
    );
    if (!blob) throw new Error('The audio file is missing from browser storage.');
    return blob;
  };
  return {
    native: false,
    store: {
      async list() {
        const values = await databaseRequest<unknown[]>('recordings', 'readonly', (store) =>
          store.getAll(),
        );
        return values
          .map(parseRecording)
          .sort((left, right) => right.created_at.localeCompare(left.created_at));
      },
      async save(recording) {
        parseRecording(recording);
        await databaseRequest('recordings', 'readwrite', (store) => store.put(recording));
      },
      remove: removeRecording,
    },
    async capabilities() {
      return {
        recording: Boolean(
          window.isSecureContext &&
          typeof navigator.mediaDevices?.getUserMedia === 'function' &&
          typeof window.MediaRecorder === 'function',
        ),
        import: true,
        sharing: true,
        playback: true,
      };
    },
    async start() {
      if (recorder && recorder.state !== 'inactive')
        throw new Error('A recording is already in progress.');
      releasePlayer();
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      try {
        const mime_type = [
          'audio/mp4',
          'audio/webm;codecs=opus',
          'audio/webm',
          'audio/ogg;codecs=opus',
        ].find((type) => MediaRecorder.isTypeSupported(type));
        recorder = new MediaRecorder(stream, mime_type ? { mimeType: mime_type } : {});
        chunks = [];
        elapsed_ms = 0;
        recording_error = null;
        let size_bytes = 0;
        recorder.ondataavailable = (event) => {
          if (!event.data.size) return;
          chunks.push(event.data);
          size_bytes += event.data.size;
          if (size_bytes > max_audio_bytes && recorder?.state === 'recording') {
            elapsed_ms = elapsed();
            recorder.pause();
            recording_error = new Error(
              'Recording reached the 128 MB limit. Save this recording to continue.',
            );
          }
        };
        recorder.onerror = () => {
          recording_error = new Error(
            'The microphone stopped unexpectedly. Save the available recording.',
          );
        };
        recorder.start(1_000);
        active_since = performance.now();
      } catch (error) {
        releaseStream();
        throw error;
      }
    },
    async pause() {
      if (recorder?.state !== 'recording') return;
      elapsed_ms = elapsed();
      recorder.pause();
    },
    async resume() {
      if (recording_error) throw recording_error;
      if (recorder?.state !== 'paused') return;
      recorder.resume();
      active_since = performance.now();
    },
    async stop() {
      if (!recorder || (recorder.state === 'inactive' && !chunks.length))
        throw new Error('There is no active recording to save.');
      const duration_ms = elapsed();
      elapsed_ms = duration_ms;
      const current = recorder;
      const blob =
        current.state === 'inactive'
          ? new Blob(chunks, { type: current.mimeType || 'audio/webm' })
          : await new Promise<Blob>((resolve) => {
              current.onstop = () =>
                resolve(new Blob(chunks, { type: current.mimeType || 'audio/webm' }));
              current.stop();
            });
      releaseStream();
      const extension = blob.type.includes('mp4')
        ? 'm4a'
        : blob.type.includes('ogg')
          ? 'ogg'
          : 'webm';
      const path = `audio/${createId()}.${extension}`;
      await databaseRequest('audio', 'readwrite', (store) => store.put(blob, path));
      chunks = [];
      recorder = null;
      return {
        path,
        file_name: `Recording.${extension}`,
        mime_type: blob.type,
        duration_ms,
        size_bytes: blob.size,
      };
    },
    async importAudio() {
      const file = await chooseAudio();
      if (!file) return null;
      if (!file.size || file.size > max_audio_bytes)
        throw new Error('Choose an audio file between 1 byte and 128 MB.');
      const duration_ms = await audioDuration(file);
      const path = `audio/${createId()}`;
      await databaseRequest('audio', 'readwrite', (store) => store.put(file, path));
      return {
        path,
        file_name: file.name,
        mime_type: file.type || 'application/octet-stream',
        duration_ms,
        size_bytes: file.size,
      };
    },
    async shareAudio(recording) {
      const blob = await getBlob(recording.path);
      await shareFile(new File([blob], recording.file_name, { type: recording.mime_type }));
    },
    async shareTranscript(recording) {
      if (!recording.transcript) throw new Error('There is no transcript to share yet.');
      await shareFile(
        new File([transcriptText(recording)], fileName(recording.title, 'txt'), {
          type: 'text/plain',
        }),
      );
    },
    async play(path) {
      if (path !== playback_path) {
        releasePlayer();
        playback_url = URL.createObjectURL(await getBlob(path));
        player = new Audio(playback_url);
        playback_path = path;
      }
      if (player?.ended) player.currentTime = 0;
      await player?.play();
    },
    async pausePlayback() {
      player?.pause();
    },
    async seek(position_ms) {
      if (player) player.currentTime = Math.max(0, position_ms / 1_000);
    },
    async status(): Promise<AudioStatus> {
      return {
        recording_state:
          recorder?.state === 'recording'
            ? 'recording'
            : recorder?.state === 'paused' || chunks.length
              ? 'paused'
              : 'idle',
        elapsed_ms: elapsed(),
        playing: Boolean(player && !player.paused && !player.ended),
        position_ms: player ? player.currentTime * 1_000 : 0,
        duration_ms: player && Number.isFinite(player.duration) ? player.duration * 1_000 : 0,
      };
    },
    async speechStatus() {
      return {
        model_ready: false,
        model_size_bytes: 0,
        busy: false,
        progress: 0,
        stage: 'unavailable',
      };
    },
    async downloadModel() {
      throw new Error(unsupported_speech);
    },
    async transcribe() {
      throw new Error(unsupported_speech);
    },
    async cancelSpeech() {},
    dispose() {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      releaseStream();
      releasePlayer();
    },
  };
}
