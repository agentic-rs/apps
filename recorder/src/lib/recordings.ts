import type {
  AudioAsset,
  CaptureDraft,
  Channel,
  Recording,
  RecordingMode,
  TextNote,
} from './types';

export function createId(
  source: Pick<Crypto, 'getRandomValues'> & Partial<Pick<Crypto, 'randomUUID'>> = crypto,
): string {
  if (typeof source.randomUUID === 'function') return source.randomUUID();
  const bytes = source.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface CreateRecordingOptions {
  id?: string;
  mode?: RecordingMode;
  channel_id?: string | null;
  started_at?: string | null;
}

export function createRecording(
  asset: AudioAsset,
  source: Recording['source'],
  options: CreateRecordingOptions = {},
): Recording {
  const created_at = new Date().toISOString();
  const mode = options.mode ?? 'document';
  return parseRecording({
    ...asset,
    schema_version: 2,
    id: options.id ?? createId(),
    title:
      source === 'import'
        ? asset.file_name.replace(/\.[^.]+$/, '') || 'Imported audio'
        : `${mode === 'clip' ? 'Clip' : 'Recording'} ${new Date(options.started_at ?? created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
    created_at,
    updated_at: created_at,
    started_at: options.started_at ?? null,
    mode,
    channel_id: options.channel_id ?? null,
    source,
    transcript: null,
    transcript_edited: false,
    transcription_state: mode === 'clip' ? 'queued' : 'idle',
    transcription_error: null,
    transcription_revision: 0,
    transcription_language: null,
  });
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid saved metadata.');
  return value as Record<string, unknown>;
}

export function isValidId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9-]+$/.test(value);
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validMode(mode: unknown, channel_id: unknown): boolean {
  return mode === 'document' ? channel_id === null : mode === 'clip' && isValidId(channel_id);
}

export function parseRecording(value: unknown): Recording {
  const record = object(value);
  if (
    ![1, 2].includes(record.schema_version as number) ||
    !isValidId(record.id) ||
    typeof record.path !== 'string' ||
    !isSafePath(record.path) ||
    typeof record.title !== 'string' ||
    typeof record.file_name !== 'string' ||
    typeof record.mime_type !== 'string' ||
    !timestamp(record.created_at) ||
    !finite(record.duration_ms) ||
    !finite(record.size_bytes) ||
    !['microphone', 'import'].includes(record.source as string) ||
    typeof record.transcript_edited !== 'boolean'
  )
    throw new Error('Invalid recording metadata.');
  if (record.transcript !== null) {
    const transcript = object(record.transcript);
    if (
      typeof transcript.text !== 'string' ||
      typeof transcript.language !== 'string' ||
      !Array.isArray(transcript.segments) ||
      (transcript.duration_ms !== undefined && !finite(transcript.duration_ms)) ||
      (transcript.model_id !== undefined && typeof transcript.model_id !== 'string') ||
      transcript.segments.some((value) => {
        if (!value || typeof value !== 'object') return true;
        const segment = value as Record<string, unknown>;
        return (
          !finite(segment.start_ms) ||
          !finite(segment.end_ms) ||
          segment.end_ms < segment.start_ms ||
          typeof segment.text !== 'string'
        );
      })
    )
      throw new Error('Invalid transcript metadata.');
  }
  if (record.schema_version === 1) {
    return {
      ...record,
      schema_version: 2,
      mode: 'document',
      channel_id: null,
      started_at: null,
      updated_at: record.created_at,
      transcription_state: record.transcript === null ? 'idle' : 'complete',
      transcription_error: null,
      transcription_revision: 0,
      transcription_language: null,
    } as Recording;
  }
  if (
    !validMode(record.mode, record.channel_id) ||
    !timestamp(record.updated_at) ||
    (record.started_at !== null && !timestamp(record.started_at)) ||
    !['idle', 'queued', 'running', 'failed', 'cancelled', 'complete'].includes(
      record.transcription_state as string,
    ) ||
    (record.transcription_error !== null && typeof record.transcription_error !== 'string') ||
    !Number.isSafeInteger(record.transcription_revision) ||
    (record.transcription_revision as number) < 0 ||
    (record.transcription_language !== null &&
      (typeof record.transcription_language !== 'string' ||
        record.transcription_language.length > 16 ||
        /[\u0000-\u001f\u007f]/.test(record.transcription_language)))
  )
    throw new Error('Invalid recording metadata.');
  return { ...record } as unknown as Recording;
}

export function createChannel(title = 'New channel'): Channel {
  const created_at = new Date().toISOString();
  return parseChannel({
    schema_version: 1,
    id: createId(),
    title: title.trim() || 'New channel',
    created_at,
    updated_at: created_at,
  });
}

export function parseChannel(value: unknown): Channel {
  const channel = object(value);
  if (
    channel.schema_version !== 1 ||
    !isValidId(channel.id) ||
    typeof channel.title !== 'string' ||
    !channel.title.trim() ||
    !timestamp(channel.created_at) ||
    !timestamp(channel.updated_at)
  ) {
    throw new Error('Invalid channel metadata.');
  }
  return { ...channel } as unknown as Channel;
}

export function createTextNote(channel_id: string, text: string): TextNote {
  return parseTextNote({
    schema_version: 1,
    id: createId(),
    channel_id,
    created_at: new Date().toISOString(),
    text: text.trim(),
  });
}

export function parseTextNote(value: unknown): TextNote {
  const note = object(value);
  if (
    note.schema_version !== 1 ||
    !isValidId(note.id) ||
    !isValidId(note.channel_id) ||
    !timestamp(note.created_at) ||
    typeof note.text !== 'string' ||
    !note.text.trim()
  )
    throw new Error('Invalid channel text note.');
  return {
    schema_version: 1,
    id: note.id,
    channel_id: note.channel_id,
    created_at: note.created_at,
    text: note.text,
  };
}

export type ChannelNote = Recording | TextNote;

export function noteTime(note: ChannelNote): string {
  return ('started_at' in note && note.started_at) || note.created_at;
}

export function groupChannelNotes(recordings: Recording[], text_notes: TextNote[]) {
  const channels = new Map<string, ChannelNote[]>();
  for (const note of [...recordings, ...text_notes]) {
    if (!note.channel_id) continue;
    const notes = channels.get(note.channel_id);
    if (notes) notes.push(note);
    else channels.set(note.channel_id, [note]);
  }
  for (const notes of channels.values()) {
    notes.sort(
      (a, b) => Date.parse(noteTime(a)) - Date.parse(noteTime(b)) || a.id.localeCompare(b.id),
    );
  }
  return channels;
}

export function parseCaptureDraft(value: unknown): CaptureDraft {
  const draft = object(value);
  if (
    draft.schema_version !== 1 ||
    !isValidId(draft.id) ||
    !validMode(draft.mode, draft.channel_id) ||
    !timestamp(draft.started_at) ||
    typeof draft.path !== 'string' ||
    !isSafePath(draft.path) ||
    typeof draft.mime_type !== 'string'
  ) {
    throw new Error('Invalid capture metadata.');
  }
  return { ...draft } as unknown as CaptureDraft;
}

export function recoverRecording(asset: AudioAsset, draft?: CaptureDraft): Recording {
  const recording = createRecording(asset, draft ? 'microphone' : 'import', draft);
  if (draft) {
    recording.created_at = draft.started_at;
  } else {
    recording.title = 'Recovered recording';
  }
  return recording;
}

export function isSafePath(path: string): boolean {
  return (
    path.length > 0 &&
    !/[\\:\u0000-\u001f\u007f]/.test(path) &&
    path
      .split('/')
      .every((component) => component !== '' && component !== '.' && component !== '..')
  );
}
export function formatTime(milliseconds: number): string {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1_000);
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remaining = String(seconds % 60).padStart(2, '0');
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${remaining}`
    : `${minutes}:${remaining}`;
}

export function formatBytes(bytes: number): string {
  return bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)} MB`
    : `${Math.ceil(bytes / 1_024)} KB`;
}

export function languageName(language: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(language) ?? language;
  } catch {
    return language;
  }
}

export function transcriptText(recording: Recording): string {
  return `${recording.title}\n${new Date(recording.created_at).toLocaleString()}\n\n${recording.transcript?.text ?? ''}\n`;
}

export function fileName(title: string, extension: string): string {
  return `${
    title
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '-')
      .trim()
      .slice(0, 120) || 'Recording'
  }.${extension}`;
}
