import type { PackingItem, Trip } from './types';

const starter_items = [
  ['documents', 'Travel documents'],
  ['wallet', 'Wallet'],
  ['charger', 'Phone charger'],
  ['toiletries', 'Toiletries'],
  ['clothes', 'Change of clothes'],
] as const;

export function packingItems(trip: Trip): readonly PackingItem[] {
  return trip.packing_items ?? starter_items.map(([id, title]) => ({ id, title, packed: false }));
}

export type PackingChange =
  | { kind: 'add'; id: string; title: string }
  | { kind: 'rename'; id: string; title: string }
  | { kind: 'pack'; id: string; packed: boolean }
  | { kind: 'remove'; id: string };

export function changePacking(trip: Trip, change: PackingChange): Trip {
  const items = [...packingItems(trip)];
  const index = items.findIndex((item) => item.id === change.id);
  if (change.kind === 'add') {
    if (index !== -1) throw new Error('An item with this identity already exists.');
    items.push({ id: change.id, title: change.title.trim(), packed: false });
  } else {
    if (index === -1) throw new Error('This item is no longer in your packing list.');
    const item = items[index];
    switch (change.kind) {
      case 'remove':
        items.splice(index, 1);
        break;
      case 'rename':
        items[index] = { ...item, title: change.title.trim() };
        break;
      case 'pack':
        items[index] = { ...item, packed: change.packed };
        break;
    }
  }
  return { ...trip, packing_items: items, updated_at: new Date().toISOString() };
}
