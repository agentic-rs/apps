import type { SpeechSettings, SpeechStatus } from './types';

export const default_speech: SpeechSettings = { provider: 'downloaded' };

export function readSpeechSettings(value: unknown): SpeechSettings {
  if (value === null || typeof value !== 'object') return default_speech;
  const entry = value as Record<string, unknown>;
  if (entry.provider === 'system') return { provider: 'system' };
  if (
    entry.provider === 'api' &&
    typeof entry.connection_id === 'string' &&
    entry.connection_id &&
    typeof entry.model_id === 'string' &&
    entry.model_id
  ) {
    return { provider: 'api', connection_id: entry.connection_id, model_id: entry.model_id };
  }
  return default_speech;
}

export function speechReady(settings: SpeechSettings, status: SpeechStatus): boolean {
  switch (settings.provider) {
    case 'downloaded':
      return status.model_ready;
    case 'system':
      return status.system_available === true;
    case 'api':
      return status.api_available === true;
  }
}
