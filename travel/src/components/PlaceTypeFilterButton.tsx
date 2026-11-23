import { placeTypeFilters, type PlaceTypeFilter } from '../lib/place-types';
import { PlaceOptionsButton } from './PlaceOptionsButton';

export function PlaceTypeFilterButton({
  category,
  value,
  disabled,
  onSelect,
}: {
  category: 'sight' | 'stay';
  value?: PlaceTypeFilter;
  disabled: boolean;
  onSelect(value?: PlaceTypeFilter): void;
}) {
  const sight = category === 'sight';
  const options = [
    { id: undefined, label: sight ? 'All sights' : 'All lodging' },
    ...placeTypeFilters(category),
  ];
  return (
    <PlaceOptionsButton
      title={sight ? 'Sight type' : 'Lodging type'}
      label={sight ? 'Filter sights by type' : 'Filter lodging by type'}
      icon="filter"
      options={options}
      value={value}
      disabled={disabled}
      onSelect={onSelect}
    />
  );
}
