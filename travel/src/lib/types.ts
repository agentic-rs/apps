export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface VisitLocation extends Coordinates {
  accuracy_m: number | null;
  source: 'device' | 'manual';
  captured_at: string | null;
}

export interface Trip {
  id: string;
  title: string;
  description: string;
  start_date: string;
  end_date: string;
  created_at: string;
  updated_at: string;
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
  place_id: string;
  visited_at: string;
  utc_offset_minutes: number;
  actual_location: VisitLocation | null;
  notes: string;
  photos: PhotoAsset[];
  created_at: string;
  updated_at: string;
}

export interface Journal {
  schema_version: 1;
  trips: Trip[];
  places: Place[];
  check_ins: CheckIn[];
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
}
