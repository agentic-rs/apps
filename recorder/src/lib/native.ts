import { fs, hostCall } from '@apell/sdk';
import { createRecording, fileName, parseRecording, transcriptText } from './recordings';
import type {
  AudioAsset,
  AudioStatus,
  Capabilities,
  RecorderPlatform,
  Recording,
  SpeechStatus,
  Transcript,
} from './types';

const metadata_directory = 'recorder-metadata';
const export_directory = 'recorder-exports';

async function readJson(path: string): Promise<unknown> {
  const decoder = new TextDecoder();
  let offset = 0;
  let text = '';
  for (;;) {
    const result = await fs.read(path, { offset, length: 65_536 });
    text += decoder.decode(new Uint8Array(result.bytes), { stream: !result.eof });
    offset += result.bytes.length;
    if (offset > 8 * 1_024 * 1_024) throw new Error('Recording metadata is too large.');
    if (result.eof) return JSON.parse(text);
    if (result.bytes.length === 0) throw new Error('Could not finish reading recording metadata.');
  }
}

export function createNativePlatform(): RecorderPlatform {
  return {
    native: true,
    store: {
      async list() {
        await fs.mkdir(metadata_directory);
        const { entries } = await fs.list(metadata_directory);
        const recordings: Recording[] = [];
        // Sequential reads avoid flooding the native bridge for large libraries.
        for (const entry of entries) {
          if (entry.kind !== 'file' || !/^[a-zA-Z0-9-]+\.json$/.test(entry.name)) continue;
          const recording = parseRecording(await readJson(`${metadata_directory}/${entry.name}`));
          if (`${recording.id}.json` !== entry.name)
            throw new Error('Recording metadata has an invalid identity.');
          recordings.push(recording);
        }
        // The host finalizes native audio when a view closes. Recover files that
        // were captured before the UI could persist their metadata.
        await fs.mkdir('recordings');
        const audio_files = await fs.list('recordings');
        const known_paths = new Set(recordings.map((recording) => recording.path));
        const mime_types: Record<string, string> = {
          m4a: 'audio/mp4',
          mp3: 'audio/mpeg',
          wav: 'audio/wav',
          flac: 'audio/flac',
          ogg: 'audio/ogg',
          aac: 'audio/aac',
        };
        for (const entry of audio_files.entries) {
          const extension = entry.name.split('.').at(-1)?.toLowerCase() ?? '';
          const path = `recordings/${entry.name}`;
          if (
            entry.kind !== 'file' ||
            !entry.size_bytes ||
            !mime_types[extension] ||
            known_paths.has(path)
          )
            continue;
          const recording = createRecording(
            {
              path,
              file_name: `Recovered recording.${extension}`,
              mime_type: mime_types[extension],
              duration_ms: 0,
              size_bytes: entry.size_bytes,
            },
            'import',
          );
          recording.title = 'Recovered recording';
          await fs.write(
            `${metadata_directory}/${recording.id}.json`,
            new TextEncoder().encode(JSON.stringify(recording)),
          );
          recordings.push(recording);
        }
        return recordings.sort((left, right) => right.created_at.localeCompare(left.created_at));
      },
      async save(recording) {
        parseRecording(recording);
        await fs.mkdir(metadata_directory);
        await fs.write(
          `${metadata_directory}/${recording.id}.json`,
          new TextEncoder().encode(JSON.stringify(recording)),
        );
      },
      async remove(recording) {
        const root = await fs.list();
        if (
          root.entries.some(
            (entry) => entry.name === export_directory && entry.kind === 'directory',
          )
        ) {
          const exports = await fs.list(export_directory);
          const export_name = `${recording.id}.txt`;
          if (exports.entries.some((entry) => entry.name === export_name)) {
            await fs.remove(`${export_directory}/${export_name}`);
          }
        }
        // Delete audio first: if it fails, preserve the visible entry for retry.
        // A missing audio file still permits removal of its stale metadata.
        const parent = recording.path.split('/').slice(0, -1).join('/');
        const name = recording.path.split('/').at(-1);
        const { entries } = await fs.list(parent);
        if (entries.some((entry) => entry.name === name)) await fs.remove(recording.path);
        await fs.remove(`${metadata_directory}/${recording.id}.json`);
      },
    },
    capabilities: () => hostCall<Capabilities>('audio.capabilities'),
    async start() {
      await hostCall('audio.start');
    },
    async pause() {
      await hostCall('audio.pause');
    },
    async resume() {
      await hostCall('audio.resume');
    },
    stop: () => hostCall<AudioAsset>('audio.stop'),
    importAudio: () => hostCall<AudioAsset | null>('audio.import'),
    async shareAudio(recording) {
      await hostCall('audio.share', {
        path: recording.path,
        file_name: recording.file_name,
        mime_type: recording.mime_type,
      });
    },
    async shareTranscript(recording) {
      if (!recording.transcript)
        throw new Error('Transcribe this recording before sharing its text.');
      await fs.mkdir(export_directory);
      const path = `${export_directory}/${recording.id}.txt`;
      await fs.write(path, new TextEncoder().encode(transcriptText(recording)));
      await hostCall('audio.share', {
        path,
        file_name: fileName(recording.title, 'txt'),
        mime_type: 'text/plain',
      });
    },
    async play(path) {
      await hostCall('audio.play', { path });
    },
    async pausePlayback() {
      await hostCall('audio.playback_pause');
    },
    async seek(position_ms) {
      await hostCall('audio.seek', { position_ms });
    },
    status: () => hostCall<AudioStatus>('audio.status'),
    speechStatus: () => hostCall<SpeechStatus>('speech.status'),
    async downloadModel() {
      await hostCall('speech.download_model');
    },
    transcribe: (path, language) =>
      hostCall<Transcript>('speech.transcribe', language ? { path, language } : { path }),
    async cancelSpeech() {
      await hostCall('speech.cancel');
    },
    dispose() {},
  };
}
