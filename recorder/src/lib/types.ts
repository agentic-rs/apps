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

export interface Recording extends AudioAsset {
  schema_version: 1;
  id: string;
  title: string;
  created_at: string;
  source: 'microphone' | 'import';
  transcript: Transcript | null;
  transcript_edited: boolean;
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

export interface SpeechStatus {
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
}

export interface RecorderPlatform {
  native: boolean;
  store: RecordingStore;
  capabilities(): Promise<Capabilities>;
  start(): Promise<void>;
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
  downloadModel(): Promise<void>;
  transcribe(path: string, language?: string): Promise<Transcript>;
  cancelSpeech(): Promise<void>;
  dispose(): void;
}
