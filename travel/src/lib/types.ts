import type { TripExpense } from './expenses';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface VisitLocation extends Coordinates {
  accuracy_m: number | null;
  source: 'device' | 'manual' | 'photo';
  captured_at: string | null;
}

export interface Trip {
  id: string;
  title: string;
  description: string;
  cities?: string[];
  /** Calendar date of transfer into each route city. The starting city and open dates use ''. */
  city_arrival_dates?: string[];
  start_date: string;
  end_date: string;
  created_at: string;
  updated_at: string;
  packing_items?: PackingItem[];
  expenses?: TripExpense[];
}

export interface PackingItem {
  id: string;
  title: string;
  packed: boolean;
}

export const stop_kinds = ['sight', 'food', 'transport', 'stay', 'other'] as const;
export type StopKind = (typeof stop_kinds)[number];
export const stop_kind_labels: Record<StopKind, string> = {
  sight: 'Sight',
  food: 'Food',
  transport: 'Transport',
  stay: 'Stay',
  other: 'Other',
};

export interface PlannedStop {
  id: string;
  trip_id: string;
  day: string;
  title: string;
  kind: StopKind;
  time: string;
  notes: string;
  position: Coordinates | null;
}

export interface Place {
  id: string;
  name: string;
  locality: string;
  position: Coordinates | null;
  created_at: string;
  updated_at: string;
}

export interface PhotoAsset {
  id: string;
  path: string;
  mime_type: string;
  size_bytes: number;
}

export interface CheckIn {
  id: string;
  trip_id: string;
  stop_id?: string;
  place_id: string | null;
  title?: string;
  visited_at: string;
  utc_offset_minutes: number;
  actual_location: VisitLocation | null;
  notes: string;
  photos: PhotoAsset[];
  created_at: string;
  updated_at: string;
}

export const journal_schema_version = 5;

export interface Journal {
  schema_version: typeof journal_schema_version;
  trips: Trip[];
  stops: PlannedStop[];
  places: Place[];
  check_ins: CheckIn[];
}

export interface EventTitleInput {
  local_time: string;
  utc_offset_minutes: number | null;
  location: Coordinates | null;
}

export interface TravelPlatform {
  native: boolean;
  load(): Promise<Journal>;
  save(journal: Journal): Promise<void>;
  importPhoto(file?: File): Promise<PhotoAsset | null>;
  capturePhoto(): Promise<PhotoAsset | null>;
  readPhoto(photo: PhotoAsset): Promise<Blob>;
  removePhoto(photo: PhotoAsset): Promise<void>;
  currentLocation(): Promise<VisitLocation | null>;
  generateEventTitle(input: EventTitleInput, signal: AbortSignal): Promise<string>;
}
