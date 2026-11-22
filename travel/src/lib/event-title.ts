import { fromVisitInput } from './dates';
import { createId } from './identity';
import { parseCoordinates, text_limits } from './model';
import type { EventTitleInput } from './types';

export type TitleModel = Pick<typeof import('@apell/sdk').llm, 'config' | 'generate'>;

const instruction =
  'Write one short, plain-text title for a journal event using only the supplied local time and coordinates. ' +
  'Use a general date or time-of-day title when the location is uncertain. ' +
  'Avoid guessing activities, people, weather, venues, or landmarks. Return only the title on one line.';

export async function generateEventTitle(
  llm: TitleModel,
  input: EventTitleInput,
  signal: AbortSignal,
): Promise<string> {
  const local_time = input.local_time || null;
  const utc_offset_minutes = local_time ? input.utc_offset_minutes : null;
  if (local_time) fromVisitInput(local_time, utc_offset_minutes ?? 0);
  const location = input.location === null ? null : parseCoordinates(input.location);
  if (!local_time && !location) throw new Error('Enter a time or location to generate a title.');

  signal.throwIfAborted();
  const config = await llm.config();
  signal.throwIfAborted();
  if (config.mode !== 'provider') {
    throw new Error('Select an active model connection in Apell settings, or enter a title.');
  }
  const request_id = createId();
  const { connection_id, model_id } = config;
  const result = await llm.generate(
    {
      request_id,
      target: { connection_id, model_id },
      stream: false,
      messages: [
        { role: 'system', content: instruction },
        { role: 'user', content: JSON.stringify({ local_time, utc_offset_minutes, location }) },
      ],
    },
    { signal },
  );
  signal.throwIfAborted();
  if (result.status !== 'completed') {
    throw new Error(
      result.error?.message || 'Title generation did not finish. Try again or enter a title.',
    );
  }
  const title = typeof result.content === 'string' ? result.content.trim() : '';
  if (
    result.request_id !== request_id ||
    result.provenance?.connection_id !== connection_id ||
    result.provenance?.requested_model_id !== model_id ||
    result.message?.role !== 'assistant' ||
    result.message.content !== result.content ||
    result.tool_calls?.length !== 0 ||
    !title ||
    title.length > text_limits.check_in_title ||
    /[\u0000-\u001f\u007f\u2028\u2029]/.test(title)
  ) {
    throw new Error('The model did not return a usable title. Try again or enter a title.');
  }
  return title;
}
