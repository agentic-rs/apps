import { createNativeStore, nativeExportPath } from './native-storage';
import { listNativeFiles } from './native-files';
import { fs, hostCall } from '@apell/sdk';
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
