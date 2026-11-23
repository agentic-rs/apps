import type { StopSearchCategory } from './stop-lookup';

function definition(label: string, osm_tag: string, ...geoapify: string[]) {
  return { label, osm_tag, geoapify };
}

// More specific categories come first. Geoapify can identify one venue as
// both a garden and a park, or both a museum and a general attraction.
const sight_types = {
  museum: definition('Museum', 'tourism:museum', 'entertainment.museum'),
  gallery: definition('Gallery', 'tourism:gallery', 'entertainment.culture.gallery'),
  garden: definition('Garden', 'leisure:garden', 'leisure.park.garden'),
  park: definition('Park', 'leisure:park', 'leisure.park'),
  place_of_worship: definition(
    'Place of worship',
    'amenity:place_of_worship',
    'religion.place_of_worship',
    'tourism.sights.place_of_worship',
  ),
  castle: definition('Castle', 'historic:castle', 'tourism.sights.castle'),
  palace: definition('Palace', 'historic:palace'),
  viewpoint: definition('Viewpoint', 'tourism:viewpoint', 'tourism.attraction.viewpoint'),
  artwork: definition('Artwork', 'tourism:artwork', 'tourism.attraction.artwork'),
  zoo: definition('Zoo', 'tourism:zoo', 'entertainment.zoo'),
  aquarium: definition('Aquarium', 'tourism:aquarium', 'entertainment.aquarium'),
  theme_park: definition('Theme park', 'tourism:theme_park', 'entertainment.theme_park'),
  attraction: definition('Attraction', 'tourism:attraction', 'tourism.attraction'),
};
const stay_types = {
  hotel: definition('Hotel', 'tourism:hotel', 'accommodation.hotel'),
  hostel: definition('Hostel', 'tourism:hostel', 'accommodation.hostel'),
  guest_house: definition('Guest house', 'tourism:guest_house', 'accommodation.guest_house'),
  apartment: definition('Apartment', 'tourism:apartment', 'accommodation.apartment'),
  motel: definition('Motel', 'tourism:motel', 'accommodation.motel'),
  resort: definition('Resort', 'tourism:resort'),
};
const place_types = { ...sight_types, ...stay_types };
export type PlaceType = keyof typeof place_types;

const filters = {
  museums: { label: 'Museums & galleries', category: 'sight', types: ['museum', 'gallery'] },
  parks: { label: 'Parks & gardens', category: 'sight', types: ['garden', 'park'] },
  worship: { label: 'Places of worship', category: 'sight', types: ['place_of_worship'] },
  hotels: { label: 'Hotels', category: 'stay', types: ['hotel'] },
  hostels: { label: 'Hostels', category: 'stay', types: ['hostel'] },
  guest_houses: { label: 'Guest houses', category: 'stay', types: ['guest_house'] },
} satisfies Record<string, { label: string; category: StopSearchCategory; types: PlaceType[] }>;
export type PlaceTypeFilter = keyof typeof filters;

const choices = (Object.keys(filters) as PlaceTypeFilter[]).map((id) => ({
  id,
  label: filters[id].label,
}));

export function placeTypeFilters(category: StopSearchCategory) {
  return choices.filter(({ id }) => filters[id].category === category);
}

export function isPlaceType(value: unknown): value is PlaceType {
  return typeof value === 'string' && Object.hasOwn(place_types, value);
}

export function placeTypeLabel(type: PlaceType): string {
  return place_types[type].label;
}

export function matchesPlaceType(type: PlaceType | undefined, filter: PlaceTypeFilter): boolean {
  return filters[filter].types.some((candidate) => candidate === type);
}

export function providerTypeFilter(filter: PlaceTypeFilter, category: StopSearchCategory) {
  const group = filters[filter];
  if (category !== group.category) throw new Error('Choose a place type for this category.');
  const types = group.types.map((type) => place_types[type]);
  const categories = types.flatMap((type) => type.geoapify);
  return {
    osm_tags: types.map((type) => type.osm_tag),
    // A parent category includes its children in a Places API request.
    geoapify: categories.filter((key) => !categories.some((other) => key.startsWith(other + '.'))),
  };
}

const osm_types = new Map(
  (Object.keys(place_types) as PlaceType[]).map((type) => [place_types[type].osm_tag, type]),
);
export function osmPlaceType(tag: string): PlaceType | undefined {
  return osm_types.get(tag);
}

const geoapify_types = {
  sight: Object.keys(sight_types) as PlaceType[],
  stay: Object.keys(stay_types) as PlaceType[],
};
export function geoapifyPlaceType(
  categories: string[],
  kind: string,
  filter?: PlaceTypeFilter,
): PlaceType | undefined {
  if (kind !== 'stay' && kind !== 'sight') return undefined;
  if (filter && filters[filter].category !== kind) return undefined;
  const types = filter ? filters[filter].types : geoapify_types[kind];
  return types.find((type) =>
    place_types[type].geoapify.some((key) =>
      categories.some((category) => category === key || category.startsWith(key + '.')),
    ),
  );
}
