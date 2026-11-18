import { fromVisitInput } from './dates';
import { createId } from './identity';
import { readCoordinates } from './model';
import type { PhotoGroup } from './photo-groups';
import type { CheckIn } from './types';

export interface EventDraft {
  id: string;
  included: boolean;
  group: PhotoGroup;
  title: string;
  title_error: string;
  local_time: string;
  offset: string;
  latitude: string;
  longitude: string;
}

export function newEventDraft(group: PhotoGroup): EventDraft {
  return {
    id: createId(),
    included: true,
    group,
    title: '',
    title_error: '',
    local_time: group.local_time ?? '',
    offset: group.utc_offset_minutes?.toString() ?? '',
    latitude: group.location?.latitude.toString() ?? '',
    longitude: group.location?.longitude.toString() ?? '',
  };
}

export function eventFromDraft(draft: EventDraft, trip_id: string, now: string): CheckIn {
  const coordinates = readCoordinates(draft.latitude, draft.longitude);
  const photo_location = draft.group.location;
  const source =
    coordinates &&
    coordinates.latitude === photo_location?.latitude &&
    coordinates.longitude === photo_location.longitude
      ? 'photo'
      : 'manual';
  if (!draft.offset) throw new Error('Choose the time zone for each event.');
  return {
    id: draft.id,
    trip_id,
    place_id: null,
    title: draft.title.trim(),
    visited_at: fromVisitInput(draft.local_time, Number(draft.offset)),
    utc_offset_minutes: Number(draft.offset),
    actual_location: coordinates
      ? { ...coordinates, source, accuracy_m: null, captured_at: null }
      : null,
    photos: draft.group.photos,
    notes: '',
    created_at: now,
    updated_at: now,
  };
}
