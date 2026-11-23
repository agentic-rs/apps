import { PlaceOptionsButton } from './PlaceOptionsButton';

const options = [
  { id: 'directory', label: 'Directory order' },
  { id: 'route', label: 'Nearest to day plan' },
] as const;

export type PlaceSortOrder = (typeof options)[number]['id'];

export function PlaceSortButton({
  value,
  onSelect,
  disabled,
}: {
  value: PlaceSortOrder;
  onSelect(value: PlaceSortOrder): void;
  disabled?: boolean;
}) {
  return (
    <PlaceOptionsButton
      title="Sort places"
      icon="sort"
      options={options}
      value={value}
      onSelect={onSelect}
      disabled={disabled}
    />
  );
}
