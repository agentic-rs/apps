import { useState } from 'react';
import { titleForCity } from '../lib/cities';
import { createId } from '../lib/identity';
import type { Trip, TripCityLocation } from '../lib/types';
import { CityPicker } from './CityPicker';

export function NewTrip({
  onSave,
  onCancel,
}: {
  onSave(trip: Trip): Promise<void>;
  onCancel(): void;
}) {
  const [id] = useState(() => createId());
  async function create(city: string, location?: TripCityLocation) {
    const now = new Date().toISOString();
    await onSave({
      id,
      title: titleForCity(city),
      cities: [city],
      ...(location && { city_locations: [location] }),
      description: '',
      start_date: '',
      end_date: '',
      created_at: now,
      updated_at: now,
    });
  }
  return <CityPicker title="Choose a city" onSelect={create} onDismiss={onCancel} />;
}
