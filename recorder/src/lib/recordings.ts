import type { AudioAsset, Recording } from './types';

export function createId(
  source: Pick<Crypto, 'getRandomValues'> & Partial<Pick<Crypto, 'randomUUID'>> = crypto,
): string {
  if (typeof source.randomUUID === 'function') return source.randomUUID();
  const bytes = source.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createRecording(asset: AudioAsset, source: Recording['source']): Recording {
  const created_at = new Date().toISOString();
  return {
    ...asset,
    schema_version: 1,
    id: createId(),
    title:
      source === 'import'
        ? asset.file_name.replace(/\.[^.]+$/, '') || 'Imported audio'
        : `Recording ${new Date(created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
    created_at,
    source,
    transcript: null,
    transcript_edited: false,
  };
}

export function parseRecording(value: unknown): Recording {
  if (!value || typeof value !== 'object') throw new Error('Invalid recording metadata.');
  const record = value as Partial<Recording>;
  const finite = (input: unknown) =>
    typeof input === 'number' && Number.isFinite(input) && input >= 0;
  if (
    record.schema_version !== 1 ||
    typeof record.id !== 'string' ||
    !/^[a-zA-Z0-9-]+$/.test(record.id) ||
    typeof record.path !== 'string' ||
    !isSafePath(record.path) ||
    typeof record.title !== 'string' ||
    typeof record.file_name !== 'string' ||
    typeof record.mime_type !== 'string' ||
    typeof record.created_at !== 'string' ||
    !Number.isFinite(Date.parse(record.created_at)) ||
    !finite(record.duration_ms) ||
    !finite(record.size_bytes) ||
    !['microphone', 'import'].includes(record.source ?? '') ||
    typeof record.transcript_edited !== 'boolean'
  )
    throw new Error('Invalid recording metadata.');
  if (record.transcript !== null) {
    const transcript = record.transcript;
    if (
      !transcript ||
      typeof transcript.text !== 'string' ||
      typeof transcript.language !== 'string' ||
      !Array.isArray(transcript.segments) ||
      transcript.segments.some(
        (segment) =>
          !segment ||
          !finite(segment.start_ms) ||
          !finite(segment.end_ms) ||
          segment.end_ms < segment.start_ms ||
          typeof segment.text !== 'string',
      )
    ) {
      throw new Error('Invalid transcript metadata.');
    }
  }
  return record as Recording;
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
