import { createNativeStore, nativeExportPath } from './native-storage';
import { listNativeFiles } from './native-files';
import { config, fs, hostCall, llm } from '@apell/sdk';
import { readSpeechSettings } from './speech';
import { fileName, transcriptText } from './recordings';
import type {
  AudioAsset,
  AudioStatus,
  Capabilities,
  RecorderPlatform,
  CaptureAsset,
  SpeechStatus,
  Transcript,
} from './types';

export function createNativePlatform(): RecorderPlatform {
  return {
    native: true,
    store: createNativeStore({
      ...fs,
      list: (path) => listNativeFiles((params) => hostCall('fs.list', params), path),
    }),
    capabilities: () => hostCall<Capabilities>('audio.capabilities'),
    start: () => hostCall<CaptureAsset>('audio.start'),
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
      const path = nativeExportPath(recording.id);
      await fs.mkdir(path.slice(0, path.lastIndexOf('/')));
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
    speechSettings: {
      async read() {
        const entry = await config.get('transcription');
        return readSpeechSettings(entry.found ? entry.value : null);
      },
      save: (settings) => config.set('transcription', { ...settings }),
      async chooseApi(current) {
        const selection = await llm.chooseModel(
          current
            ? {
                current: { connection_id: current.connection_id, model_id: current.model_id },
              }
            : {},
        );
        if (!selection) return null;
        if (!['openai', 'custom'].includes(selection.provider_id))
          throw new Error(
            'Choose an OpenAI or OpenAI-compatible connection with an audio transcription model.',
          );
        return {
          provider: 'api',
          connection_id: selection.connection_id,
          model_id: selection.model_id,
        };
      },
    },
    async downloadModel() {
      await hostCall('speech.download_model');
    },
    transcribe: (path, language, settings) =>
      hostCall<Transcript>('speech.transcribe', {
        path,
        ...(language ? { language } : {}),
        ...settings,
      }),
    async cancelSpeech() {
      await hostCall('speech.cancel');
    },
    dispose() {},
  };
}
