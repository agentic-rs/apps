export interface AudioAsset {
  path: string;
  file_name: string;
  mime_type: string;
  duration_ms: number;
  size_bytes: number;
}

export interface TranscriptSegment {
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface Transcript {
  text: string;
  language: string;
  segments: TranscriptSegment[];
  duration_ms?: number;
  model_id?: string;
}

export type RecordingMode = 'document' | 'clip';
export type TranscriptionState =
  'idle' | 'queued' | 'running' | 'failed' | 'cancelled' | 'complete';

export interface Recording extends AudioAsset {
  schema_version: 2;
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  mode: RecordingMode;
  channel_id: string | null;
  source: 'microphone' | 'import';
  transcript: Transcript | null;
  transcript_edited: boolean;
  transcription_state: TranscriptionState;
  transcription_error: string | null;
  transcription_revision: number;
  transcription_language: string | null;
}

export interface Channel {
  schema_version: 1;
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface TextNote {
  schema_version: 1;
  id: string;
  channel_id: string;
  created_at: string;
  text: string;
}

export interface CaptureDraft {
  schema_version: 1;
  id: string;
  mode: RecordingMode;
  channel_id: string | null;
  started_at: string;
  path: string;
  mime_type: string;
}

export interface CaptureAsset {
  path: string;
  mime_type: string;
}

export interface AudioStatus {
  recording_state: 'idle' | 'recording' | 'paused';
  elapsed_ms: number;
  playing: boolean;
  position_ms: number;
  duration_ms: number;
}

export interface Capabilities {
  recording: boolean;
  import: boolean;
  sharing: boolean;
  playback: boolean;
}

export type SpeechSettings =
  | { provider: 'system' }
  | { provider: 'downloaded' }
  | { provider: 'api'; connection_id: string; model_id: string };

export interface SpeechStatus {
  system_available?: boolean;
  system_unavailable_reason?: string | null;
  api_available?: boolean;
  model_ready: boolean;
  model_size_bytes: number;
  busy: boolean;
  progress: number;
  stage: string;
}

export interface RecordingStore {
  list(): Promise<Recording[]>;
  save(recording: Recording): Promise<void>;
  remove(recording: Recording): Promise<void>;
  listChannels(): Promise<Channel[]>;
  saveChannel(channel: Channel): Promise<void>;
  removeChannel(id: string): Promise<void>;
  listTextNotes(): Promise<TextNote[]>;
  addTextNote(note: TextNote): Promise<void>;
  removeTextNote(id: string): Promise<void>;
  saveCapture(draft: CaptureDraft): Promise<void>;
  clearCapture(id: string): Promise<void>;
}

export interface RecorderPlatform {
  native: boolean;
  store: RecordingStore;
  capabilities(): Promise<Capabilities>;
  start(): Promise<CaptureAsset>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<AudioAsset>;
  importAudio(): Promise<AudioAsset | null>;
  shareAudio(recording: Recording): Promise<void>;
  shareTranscript(recording: Recording): Promise<void>;
  play(path: string): Promise<void>;
  pausePlayback(): Promise<void>;
  seek(position_ms: number): Promise<void>;
  status(): Promise<AudioStatus>;
  speechStatus(): Promise<SpeechStatus>;
  speechSettings?: {
    read(): Promise<SpeechSettings>;
    save(settings: SpeechSettings): Promise<void>;
    chooseApi(
      current?: Extract<SpeechSettings, { provider: 'api' }>,
    ): Promise<Extract<SpeechSettings, { provider: 'api' }> | null>;
  };
  downloadModel(): Promise<void>;
  transcribe(
    path: string,
    language: string | undefined,
    settings: SpeechSettings,
  ): Promise<Transcript>;
  cancelSpeech(): Promise<void>;
  dispose(): void;
}
