import type { TripExpense } from './expenses';
import type { PlaceType } from './place-types';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface TripCityLocation extends Coordinates {
  id: string;
  country_code: string;
}

export interface DirectoryRef {
  /** Original directory name, independent of a traveler's itinerary title. */
  name?: string;
  country_code?: string;
  subtitle?: string;
  place_type?: PlaceType;
  /** The underlying OSM element when a service uses a different ID for the same place. */
  osm_ref?: string;
  provider: 'ourairports' | 'osm' | 'geoapify';
  id: string;
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
  /** Aligned to route cities; manual and older entries have no directory location. */
  city_locations?: (TripCityLocation | null)[];
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
  /** The city selected in the planner, which can differ from the provider's locality. */
  city?: string;
  city_id?: string;
  checkout_date?: string;
  title: string;
  kind: StopKind;
  time: string;
  notes: string;
  position: Coordinates | null;
  directory_ref?: DirectoryRef;
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
  /** IANA rules used for city-local time. The recorded offset preserves the original wall clock. */
  time_zone?: string;
  actual_location: VisitLocation | null;
  notes: string;
  photos: PhotoAsset[];
  created_at: string;
  updated_at: string;
}

export const journal_schema_version = 9;

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
  onBack?(handle: () => boolean): () => void;
  load(): Promise<Journal>;
  save(journal: Journal): Promise<void>;
  importPhoto(file?: File): Promise<PhotoAsset | null>;
  capturePhoto(): Promise<PhotoAsset | null>;
  readPhoto(photo: PhotoAsset): Promise<Blob>;
  removePhoto(photo: PhotoAsset): Promise<void>;
  currentLocation(): Promise<VisitLocation | null>;
  generateEventTitle(input: EventTitleInput, signal: AbortSignal): Promise<string>;
}
